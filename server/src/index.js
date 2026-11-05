import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import {
  cleanDisplayName,
  cleanEmail,
  createToken,
  hashPassword,
  hashToken,
  publicUser,
  SESSION_TTL,
  verifyPassword,
} from './auth.js';
import { Metrics } from './metrics.js';
import { moderateFilm, moderationProvider } from './moderation.js';
import { RoomManager } from './rooms.js';
import { Store } from './store.js';

const PORT = Number(process.env.PORT) || 3001;
const ADMIN_EMAIL = cleanEmail(process.env.ADMIN_EMAIL || 'admin@example.com') || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../../client/dist');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(here, '../data');

const store = new Store(path.join(dataDir, 'db.json'));
const metrics = new Metrics(path.join(dataDir, 'stats.json'));
const rooms = new RoomManager();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '128kb' }));
app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.use(express.static(clientDist));

const indexFile = path.join(clientDist, 'index.html');

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const reply = (ack, payload) => {
  if (typeof ack === 'function') ack(payload);
};

const broadcast = (room) => {
  io.to(room.id).emit('room:state', rooms.serialize(room));
};

function seedAdmin() {
  const existing = store.findUserByEmail(ADMIN_EMAIL);
  if (existing) return;
  store.addUser({
    id: randomUUID(),
    email: ADMIN_EMAIL,
    name: 'Quản trị',
    passwordHash: hashPassword(ADMIN_PASSWORD),
    role: 'admin',
    banned: false,
    createdAt: Date.now(),
    lastLoginAt: 0,
  });
  console.warn(
    `[admin] Đã tạo tài khoản quản trị ${ADMIN_EMAIL}. Đổi ADMIN_EMAIL/ADMIN_PASSWORD trước khi deploy.`,
  );
}

seedAdmin();

const authAttempts = new Map();
function rateLimited(key, max = 20, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const entry = authAttempts.get(key);
  if (!entry || entry.resetAt < now) {
    authAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

function issueSession(user) {
  const token = createToken();
  store.createSession(hashToken(token), user.id, Date.now() + SESSION_TTL);
  return token;
}

function userFromRequest(req) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const session = store.findSession(hashToken(token));
  if (!session) return null;
  const user = store.findUserById(session.userId);
  if (!user || user.banned) return null;
  return user;
}

function requireAuth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Bạn cần đăng nhập.' });
  req.user = user;
  req.token = req.get('authorization').slice(7).trim();
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ quản trị viên được làm việc này.' });
  }
  next();
}

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function cleanText(value, max) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return text.slice(0, max);
}

function newTheatreId() {
  let id;
  do {
    id = randomBytes(3).toString('hex').toUpperCase();
  } while (store.findTheatre(id));
  return id;
}

function theatreView(theatre) {
  const owner = store.findUserById(theatre.ownerId);
  return {
    id: theatre.id,
    name: theatre.name,
    description: theatre.description || '',
    visibility: theatre.visibility,
    status: theatre.status,
    videoKind: theatre.video.kind,
    owner: owner ? { id: owner.id, name: owner.name } : { id: theatre.ownerId, name: 'Không rõ' },
    online: rooms.count(theatre.id),
    createdAt: theatre.createdAt,
    moderation: {
      verdict: theatre.moderation?.verdict || 'allowed',
      provider: theatre.moderation?.provider || 'local',
      reason: theatre.moderation?.reason || '',
    },
  };
}

function listTheatresFor(user) {
  return store
    .listTheatres()
    .filter(
      (theatre) =>
        theatre.ownerId === user.id ||
        (theatre.visibility === 'public' && theatre.status === 'open'),
    )
    .map(theatreView);
}

function closeLiveTheatre(theatreId, reason) {
  const room = rooms.close(theatreId);
  if (!room) return;
  io.to(theatreId).emit('room:closed', { reason });
  io.in(theatreId).socketsLeave(theatreId);
}

function disconnectUser(userId) {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.userId === userId) socket.disconnect(true);
  }
}

function buildAdminStats() {
  const live = rooms.adminSnapshot();
  const flat = live.flatMap((room) => room.users.map((user) => ({ ...user, theatreId: room.id })));
  const onlineUserIds = new Set();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.userId) onlineUserIds.add(socket.data.userId);
  }
  return {
    now: Date.now(),
    uptime: Math.round(process.uptime()),
    connected: io.engine.clientsCount,
    uniqueUsers: onlineUserIds.size,
    online: flat.length,
    lobby: Math.max(0, onlineUserIds.size - flat.length),
    seated: flat.filter((user) => user.seatId).length,
    speaking: flat.filter((user) => user.speaking).length,
    voice: flat.filter((user) => user.voice).length,
    rooms: live.sort((a, b) => b.createdAt - a.createdAt),
    today: metrics.today(),
    recent: metrics.recent(7),
    totalSessions: metrics.totalSessions(),
    users: store.data.users.length,
    theatres: store.data.theatres.length,
    moderationProvider: moderationProvider(),
  };
}

/* ------------------------------------------------------------------ Auth */

app.post(
  '/api/auth/register',
  wrap(async (req, res) => {
    if (rateLimited(`register:${req.ip}`, 10)) {
      return res.status(429).json({ error: 'Thử quá nhiều lần. Đợi vài phút.' });
    }
    const email = cleanEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const name = cleanDisplayName(req.body?.name);

    if (!email) return res.status(400).json({ error: 'Email không hợp lệ.' });
    if (!name || name.length < 2) return res.status(400).json({ error: 'Tên cần ít nhất 2 ký tự.' });
    if (password.length < 8) {
      return res.status(400).json({ error: 'Mật khẩu cần ít nhất 8 ký tự.' });
    }
    if (store.findUserByEmail(email)) {
      return res.status(409).json({ error: 'Email này đã được đăng ký.' });
    }

    const user = {
      id: randomUUID(),
      email,
      name,
      passwordHash: hashPassword(password),
      role: 'user',
      banned: false,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    };
    store.addUser(user);
    const token = issueSession(user);
    res.status(201).json({ token, user: publicUser(user) });
  }),
);

app.post(
  '/api/auth/login',
  wrap(async (req, res) => {
    if (rateLimited(`login:${req.ip}`, 30)) {
      return res.status(429).json({ error: 'Thử quá nhiều lần. Đợi vài phút.' });
    }
    const email = cleanEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = store.findUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng.' });
    }
    if (user.banned) {
      return res.status(403).json({ error: 'Tài khoản đã bị khoá.' });
    }
    store.updateUser(user.id, { lastLoginAt: Date.now() });
    const token = issueSession(user);
    res.json({ token, user: publicUser(user) });
  }),
);

app.post('/api/auth/logout', requireAuth, (req, res) => {
  store.deleteSession(hashToken(req.token));
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/* --------------------------------------------------------------- Theatres */

app.get('/api/theatres', requireAuth, (req, res) => {
  res.json({ theatres: listTheatresFor(req.user) });
});

app.post(
  '/api/theatres',
  requireAuth,
  wrap(async (req, res) => {
    const name = cleanText(req.body?.name, 60);
    const description = cleanText(req.body?.description, 300);
    const kind = req.body?.video?.kind === 'youtube' ? 'youtube' : 'html5';
    const src = cleanText(req.body?.video?.src, 2048);
    const visibility = req.body?.visibility === 'private' ? 'private' : 'public';

    if (name.length < 2) return res.status(400).json({ error: 'Tên rạp cần ít nhất 2 ký tự.' });
    if (!src) return res.status(400).json({ error: 'Thiếu đường dẫn phim.' });

    const verdict = await moderateFilm({ name, description, src });
    store.logModeration({
      id: randomUUID(),
      at: Date.now(),
      userId: req.user.id,
      email: req.user.email,
      name,
      src,
      verdict: verdict.verdict,
      provider: verdict.provider,
      reason: verdict.reason,
    });

    if (verdict.verdict === 'blocked') {
      return res.status(422).json({
        error: 'Phim bị chặn bởi kiểm duyệt.',
        reason: verdict.reason,
      });
    }

    const theatre = {
      id: newTheatreId(),
      name,
      description,
      ownerId: req.user.id,
      visibility,
      video: { kind, src },
      status: 'open',
      moderation: verdict,
      createdAt: Date.now(),
    };
    store.addTheatre(theatre);
    res.status(201).json({ theatre: theatreView(theatre) });
  }),
);

app.patch('/api/theatres/:id', requireAuth, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  if (theatre.ownerId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Bạn không phải chủ rạp.' });
  }
  const status = req.body?.status === 'closed' ? 'closed' : 'open';
  store.updateTheatre(theatre.id, { status });
  if (status === 'closed') closeLiveTheatre(theatre.id, 'Rạp đã đóng.');
  res.json({ ok: true, theatre: theatreView(theatre) });
});

app.delete('/api/theatres/:id', requireAuth, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  if (theatre.ownerId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Bạn không phải chủ rạp.' });
  }
  closeLiveTheatre(theatre.id, 'Rạp đã bị xoá.');
  store.deleteTheatre(theatre.id);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- Admin */

app.get('/api/admin/overview', requireAuth, requireAdmin, (req, res) => {
  const stats = buildAdminStats();
  const onlineUserIds = new Set();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.userId) onlineUserIds.add(socket.data.userId);
  }

  const users = store.listUsers().map((user) => ({
    ...publicUser(user),
    online: onlineUserIds.has(user.id),
  }));

  const theatres = store.listTheatres().map((theatre) => {
    const owner = store.findUserById(theatre.ownerId);
    return {
      ...theatreView(theatre),
      ownerEmail: owner?.email || '',
      video: { kind: theatre.video.kind },
    };
  });

  res.json({
    stats,
    users,
    theatres,
    moderation: [...store.data.moderation].reverse().slice(0, 100),
  });
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const target = store.findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });

  const patch = {};
  if (typeof req.body?.banned === 'boolean') patch.banned = req.body.banned;
  if (req.body?.role === 'admin' || req.body?.role === 'user') patch.role = req.body.role;

  if (target.id === req.user.id && (patch.banned || patch.role === 'user')) {
    return res.status(400).json({ error: 'Không thể tự khoá hoặc tự hạ quyền.' });
  }
  if (patch.role === 'user') {
    const admins = store.listUsers().filter((user) => user.role === 'admin');
    if (admins.length <= 1) return res.status(400).json({ error: 'Cần giữ ít nhất một quản trị viên.' });
  }

  store.updateUser(target.id, patch);
  if (patch.banned) {
    store.deleteSessionsForUser(target.id);
    disconnectUser(target.id);
  }
  res.json({ ok: true, user: publicUser(store.findUserById(target.id)) });
});

app.patch('/api/admin/theatres/:id', requireAuth, requireAdmin, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  const status = req.body?.status === 'closed' ? 'closed' : 'open';
  store.updateTheatre(theatre.id, { status });
  if (status === 'closed') closeLiveTheatre(theatre.id, 'Rạp đã bị quản trị viên đóng.');
  res.json({ ok: true, theatre: theatreView(theatre) });
});

app.delete('/api/admin/theatres/:id', requireAuth, requireAdmin, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  closeLiveTheatre(theatre.id, 'Rạp đã bị quản trị viên xoá.');
  store.deleteTheatre(theatre.id);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- Socket */

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const session = token ? store.findSession(hashToken(token)) : null;
  const user = session ? store.findUserById(session.userId) : null;
  if (!user || user.banned) return next(new Error('unauthorized'));
  socket.data.user = publicUser(user);
  socket.data.userId = user.id;
  next();
});

io.on('connection', (socket) => {
  socket.on('time:sync', (clientTime, ack) => {
    reply(ack, {
      clientTime: typeof clientTime === 'number' ? clientTime : null,
      serverTime: Date.now(),
    });
  });

  socket.on('room:join', (payload, ack) => {
    const user = socket.data.user;
    const theatre = store.findTheatre(String(payload?.theatreId || '').toUpperCase());
    if (!theatre) return reply(ack, { ok: false, error: 'Không tìm thấy rạp này.' });
    if (theatre.status !== 'open') {
      return reply(ack, { ok: false, error: 'Rạp đang đóng.' });
    }

    const result = rooms.join(theatre, user, socket.id);
    if (result.error) return reply(ack, { ok: false, error: result.error });

    socket.join(theatre.id);
    metrics.recordSession(user.id);
    reply(ack, { ok: true, room: rooms.serialize(result.room) });
    socket.to(theatre.id).emit('system', { text: `${user.name} đã vào rạp.` });
    broadcast(result.room);
  });

  socket.on('room:leave', () => leaveRoom(socket));

  socket.on('seat:claim', (payload, ack) => {
    const result = rooms.claimSeat(socket.id, payload?.seatId);
    if (result.error) return reply(ack, { ok: false, error: result.error });
    broadcast(result.room);
    reply(ack, { ok: true });
  });

  socket.on('video:control', (payload, ack) => {
    const result = rooms.controlVideo(socket.id, payload);
    if (result.error) return reply(ack, { ok: false, error: result.error });
    broadcast(result.room);
    reply(ack, { ok: true });
  });

  socket.on('chat:send', (payload) => {
    const room = rooms.roomOf(socket.id);
    if (!room) return;
    const text = String(payload?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!text) return;
    const user = room.users.get(socket.id);
    if (!user) return;

    io.to(room.id).emit('chat:message', {
      id: `${socket.id}-${Date.now()}`,
      userId: socket.id,
      name: user.name,
      seatId: user.seatId,
      text,
      ts: Date.now(),
    });
  });

  socket.on('voice:join', (payload, ack) => {
    const room = rooms.roomOf(socket.id);
    if (!room) return reply(ack, { ok: false, error: 'Bạn chưa ở trong rạp.' });

    const peers = [...room.users.values()]
      .filter((user) => user.voice && user.id !== socket.id)
      .map((user) => user.id);

    const updated = rooms.setVoice(socket.id, {
      active: true,
      speaking: Boolean(payload?.speaking),
    });
    reply(ack, { ok: true, peers });
    if (updated) broadcast(updated);
  });

  socket.on('voice:speaking', (payload) => {
    const room = rooms.setVoice(socket.id, { speaking: Boolean(payload?.speaking) });
    if (room) broadcast(room);
  });

  socket.on('voice:leave', () => {
    const room = rooms.setVoice(socket.id, { active: false });
    if (room) broadcast(room);
  });

  socket.on('voice:mute', (payload) => {
    const room = rooms.setVoice(socket.id, { muted: Boolean(payload?.muted) });
    if (room) broadcast(room);
  });

  socket.on('voice:signal', (payload) => {
    const room = rooms.roomOf(socket.id);
    const target = payload?.to;
    if (!room || !target || !payload?.data) return;
    if (!room.users.has(target)) return;
    io.to(target).emit('voice:signal', { from: socket.id, data: payload.data });
  });

  socket.on('admin:subscribe', (ack) => {
    if (socket.data.user?.role !== 'admin') return reply(ack, { ok: false });
    socket.join('admins');
    socket.emit('admin:stats', buildAdminStats());
    reply(ack, { ok: true });
  });

  socket.on('admin:unsubscribe', () => {
    socket.leave('admins');
  });

  socket.on('disconnect', () => {
    const result = rooms.leave(socket.id);
    if (!result || result.empty) return;
    io.to(result.room.id).emit('room:state', rooms.serialize(result.room));
    io.to(result.room.id).emit('system', { text: `${result.name} đã rời rạp.` });
    io.to(result.room.id).emit('voice:peer-left', { id: socket.id });
  });
});

function leaveRoom(socket) {
  const result = rooms.leave(socket.id);
  if (!result || result.empty) return;
  socket.leave(result.room.id);
  broadcast(result.room);
  io.to(result.room.id).emit('system', { text: `${result.name} đã rời rạp.` });
}

const sweeper = setInterval(() => {
  rooms.sweep();
  store.pruneSessions();
  store.save();
}, 10 * 60 * 1000);
sweeper.unref?.();

const adminPusher = setInterval(() => {
  const admins = io.sockets.adapter.rooms.get('admins');
  if (!admins || admins.size === 0) return;
  io.to('admins').emit('admin:stats', buildAdminStats());
}, 2000);
adminPusher.unref?.();

if (fs.existsSync(indexFile)) {
  app.get('*', (req, res) => res.sendFile(indexFile));
}

server.listen(PORT, () => {
  console.log(`Virtual Cinema API đang chạy tại http://localhost:${PORT}`);
  console.log(`Trang quản trị: http://localhost:${PORT}/admin`);
  console.log(`Dữ liệu: ${dataDir}`);
});
