import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
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
import { initDb, isDbConnected, loadSnapshot, saveSnapshot } from './db.js';
import { Metrics } from './metrics.js';
import { moderateFilm, moderationProvider, screenText } from './moderation.js';
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
app.set('trust proxy', 1);
app.use(compression());
app.use(cors({ origin: true }));
app.use(express.json({ limit: '128kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (
    req.path.startsWith('/admin') ||
    req.path.startsWith('/api/') ||
    req.path.startsWith('/socket.io/')
  ) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});
app.get('/health', (req, res) =>
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    db: isDbConnected(),
    rooms: rooms.rooms.size,
  }),
);
app.use(
  express.static(clientDist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }),
);

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
    strikes: 0,
    createdAt: Date.now(),
    lastLoginAt: 0,
  });
  console.warn(
    `[admin] Đã tạo tài khoản quản trị ${ADMIN_EMAIL}. Đổi ADMIN_EMAIL/ADMIN_PASSWORD trước khi deploy.`,
  );
}

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

function theatreView(theatre, full = false) {
  const owner = store.findUserById(theatre.ownerId);
  const view = {
    id: theatre.id,
    name: theatre.name,
    description: theatre.description || '',
    visibility: theatre.visibility,
    status: theatre.status,
    videoKind: theatre.video.kind,
    owner: owner ? { id: owner.id, name: owner.name } : { id: theatre.ownerId, name: 'Không rõ' },
    online: rooms.count(theatre.id),
    createdAt: theatre.createdAt,
    hostOverride: theatre.hostOverride || null,
    appeal: theatre.appeal || null,
    mature: Boolean(theatre.mature),
    deletedAt: theatre.deletedAt || null,
    moderation: {
      verdict: theatre.moderation?.verdict || 'allowed',
      provider: theatre.moderation?.provider || 'local',
      reason: theatre.moderation?.reason || '',
    },
  };
  if (full) {
    view.moderators = theatre.moderators || [];
    view.bannedUsers = theatre.bannedUsers || [];
  }
  return view;
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

function kickUserFromTheatre(theatreId, accountId) {
  const room = rooms.getRoom(theatreId);
  if (!room) return;
  for (const [socketId, member] of room.users) {
    if (member.accountId !== accountId) continue;
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit('room:kicked', { reason: 'Bạn đã bị đưa ra khỏi rạp.' });
      socket.disconnect(true);
    }
  }
}

const MAX_THEATRES_PER_USER = 5;
const CHAT_BUCKETS = new Map();
const JOIN_BUCKETS = new Map();
const REPORT_BUCKETS = new Map();

function tooManyAttempts(map, key, max, windowMs) {
  const now = Date.now();
  const list = (map.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  list.push(now);
  map.set(key, list);
  return list.length > max;
}

function addAudit(actor, action, detail = {}) {
  const entry = {
    id: randomUUID(),
    at: Date.now(),
    actorId: actor?.id || null,
    actorEmail: actor?.email || 'system',
    action,
    ...detail,
  };
  store.data.audit.push(entry);
  if (store.data.audit.length > 500) store.data.audit = store.data.audit.slice(-500);
  store.save();
  return entry;
}

function isMuted(theatre, accountId) {
  const until = theatre.mutedUsers?.[accountId];
  return Boolean(until && until > Date.now());
}

function sweepTheatres() {
  const now = Date.now();
  const PURGE_AFTER = 30 * 24 * 60 * 60 * 1000;
  const ARCHIVE_AFTER = 30 * 24 * 60 * 60 * 1000;
  let changed = false;

  for (const theatre of [...store.data.theatres]) {
    const last = theatre.lastActiveAt || theatre.createdAt || now;
    if (theatre.status === 'deleted') {
      if (theatre.deletedAt && now - theatre.deletedAt > PURGE_AFTER) {
        store.data.theatres = store.data.theatres.filter((item) => item.id !== theatre.id);
        changed = true;
      }
      continue;
    }
    if ((theatre.status === 'open' || theatre.status === 'closed') && now - last > ARCHIVE_AFTER) {
      theatre.status = 'archived';
      changed = true;
    }
  }
  if (changed) store.save();
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
      strikes: 0,
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

app.delete('/api/account', requireAuth, (req, res) => {
  const user = store.findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
  if (!verifyPassword(String(req.body?.password ?? ''), user.passwordHash)) {
    return res.status(400).json({ error: 'Mật khẩu không đúng.' });
  }

  for (const theatre of store.data.theatres.filter((item) => item.ownerId === user.id)) {
    closeLiveTheatre(theatre.id, 'Chủ rạp đã xoá tài khoản.');
  }
  store.data.theatres = store.data.theatres.filter((item) => item.ownerId !== user.id);
  for (const entry of store.data.audit) {
    if (entry.actorId === user.id) entry.actorEmail = 'deleted-user';
  }
  for (const report of store.data.reports) {
    if (report.reporterId === user.id) report.reporterEmail = 'deleted-user';
  }
  store.deleteSessionsForUser(user.id);
  store.data.users = store.data.users.filter((item) => item.id !== user.id);
  store.save();
  disconnectUser(user.id);
  res.json({ ok: true });
});

app.get('/api/account/export', requireAuth, (req, res) => {
  const user = store.findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
  res.json({
    user: publicUser(user),
    theatres: store.data.theatres
      .filter((theatre) => theatre.ownerId === user.id)
      .map((theatre) => theatreView(theatre, true)),
    audit: store.data.audit.filter((entry) => entry.actorId === user.id),
    reports: store.data.reports.filter((report) => report.reporterId === user.id),
  });
});

app.post('/api/account/password', requireAuth, (req, res) => {
  const user = store.findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
  if (!verifyPassword(String(req.body?.currentPassword ?? ''), user.passwordHash)) {
    return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng.' });
  }
  const next = String(req.body?.newPassword ?? '');
  if (next.length < 8) {
    return res.status(400).json({ error: 'Mật khẩu mới cần ít nhất 8 ký tự.' });
  }
  store.updateUser(user.id, { passwordHash: hashPassword(next) });
  store.deleteSessionsForUser(user.id, hashToken(req.token));
  addAudit(req.user, 'password_change', {});
  res.json({ ok: true });
});

app.post('/api/account/adult', requireAuth, (req, res) => {
  store.updateUser(req.user.id, { adultConfirmed: Boolean(req.body?.confirmed) });
  addAudit(req.user, 'adult_confirm', { confirmed: Boolean(req.body?.confirmed) });
  res.json({ ok: true });
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
    const owned = store.data.theatres.filter(
      (item) =>
        item.ownerId === req.user.id && !['deleted', 'archived'].includes(item.status),
    ).length;
    if (owned >= MAX_THEATRES_PER_USER) {
      return res
        .status(400)
        .json({ error: `Mỗi tài khoản chỉ được mở tối đa ${MAX_THEATRES_PER_USER} rạp.` });
    }

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
      status: verdict.verdict === 'flagged' ? 'pending_review' : 'open',
      mature: Boolean(req.body?.mature),
      moderation: verdict,
      moderators: [],
      bannedUsers: [],
      mutedUsers: {},
      hostOverride: null,
      appeal: null,
      lastActiveAt: Date.now(),
      createdAt: Date.now(),
    };
    store.addTheatre(theatre);
    addAudit(req.user, 'theatre_create', { theatreId: theatre.id, status: theatre.status });
    res.status(201).json({ theatre: theatreView(theatre) });
  }),
);

app.patch('/api/theatres/:id', requireAuth, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  if (theatre.ownerId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Bạn không phải chủ rạp.' });
  }

  const patch = {};
  if (req.body?.status === 'closed' || req.body?.status === 'open') patch.status = req.body.status;
  if (patch.status && !['open', 'closed'].includes(theatre.status)) {
    return res.status(409).json({
      error: 'Rạp đang chờ duyệt/bị từ chối/đã xoá — dùng khiếu nại, khôi phục hoặc chờ quản trị viên.',
    });
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'hostOverride')) {
    patch.hostOverride =
      req.body.hostOverride && typeof req.body.hostOverride === 'string'
        ? req.body.hostOverride
        : null;
  }

  store.updateTheatre(theatre.id, patch);
  if (patch.status === 'closed') closeLiveTheatre(theatre.id, 'Rạp đã đóng.');
  if (patch.status) {
    addAudit(req.user, patch.status === 'closed' ? 'theatre_close' : 'theatre_open', {
      theatreId: theatre.id,
    });
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'hostOverride')) {
    addAudit(req.user, 'host_delegate', {
      theatreId: theatre.id,
      hostOverride: patch.hostOverride,
    });
  }
  res.json({ ok: true, theatre: theatreView(theatre, true) });
});

app.delete('/api/theatres/:id', requireAuth, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  if (theatre.ownerId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Bạn không phải chủ rạp.' });
  }
  closeLiveTheatre(theatre.id, 'Rạp đã bị xoá.');
  store.updateTheatre(theatre.id, { status: 'deleted', deletedAt: Date.now() });
  addAudit(req.user, 'theatre_trash', { theatreId: theatre.id, name: theatre.name });
  res.json({ ok: true });
});

app.post('/api/theatres/:id/restore', requireAuth, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  if (theatre.ownerId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Bạn không phải chủ rạp.' });
  }
  if (!['deleted', 'archived'].includes(theatre.status)) {
    return res.status(400).json({ error: 'Rạp không ở trạng thái có thể khôi phục.' });
  }
  store.updateTheatre(theatre.id, {
    status: 'open',
    deletedAt: null,
    lastActiveAt: Date.now(),
  });
  addAudit(req.user, 'theatre_restore', { theatreId: theatre.id });
  res.json({ ok: true, theatre: theatreView(theatre, true) });
});

app.post('/api/theatres/:id/transfer', requireAuth, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  if (theatre.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Chỉ chủ rạp được chuyển nhượng.' });
  }
  const email = cleanEmail(req.body?.email);
  const target = email ? store.findUserByEmail(email) : null;
  if (!target) return res.status(400).json({ error: 'Không tìm thấy người dùng với email đó.' });
  if (target.id === theatre.ownerId) {
    return res.status(400).json({ error: 'Rạp đã thuộc người này.' });
  }
  if (target.banned) {
    return res.status(400).json({ error: 'Không thể chuyển cho tài khoản đang bị khoá.' });
  }
  const targetOwned = store.data.theatres.filter(
    (item) => item.ownerId === target.id && !['deleted', 'archived'].includes(item.status),
  ).length;
  if (targetOwned >= MAX_THEATRES_PER_USER) {
    return res.status(400).json({ error: 'Người nhận đã đạt giới hạn số rạp.' });
  }
  store.updateTheatre(theatre.id, { ownerId: target.id });
  rooms.reassignOwner(theatre.id, target.id);
  addAudit(req.user, 'theatre_transfer', {
    theatreId: theatre.id,
    toEmail: target.email,
  });
  const room = rooms.getRoom(theatre.id);
  if (room) broadcast(room);
  res.json({ ok: true, theatre: theatreView(theatre, true) });
});

function canModerate(theatre, user) {
  return (
    user.role === 'admin' ||
    theatre.ownerId === user.id ||
    Array.isArray(theatre.moderators) && theatre.moderators.includes(user.id)
  );
}

app.post('/api/theatres/:id/moderators', requireAuth, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  if (theatre.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Chỉ chủ rạp được bổ nhiệm điều phối viên.' });
  }
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const action = req.body?.action;
  if (!userId || (action !== 'add' && action !== 'remove')) {
    return res.status(400).json({ error: 'Thiếu userId hoặc hành động.' });
  }
  const moderators = new Set(theatre.moderators || []);
  if (action === 'add') moderators.add(userId);
  else moderators.delete(userId);
  store.updateTheatre(theatre.id, { moderators: [...moderators] });
  const room = rooms.getRoom(theatre.id);
  if (room) {
    room.moderators = [...moderators];
    broadcast(room);
  }
  addAudit(req.user, action === 'add' ? 'moderator_add' : 'moderator_remove', {
    theatreId: theatre.id,
    userId,
  });
  res.json({ ok: true, theatre: theatreView(theatre, true) });
});

app.post('/api/theatres/:id/ban', requireAuth, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  if (!canModerate(theatre, req.user)) {
    return res.status(403).json({ error: 'Bạn không có quyền cấm người khỏi rạp.' });
  }
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  if (!userId) return res.status(400).json({ error: 'Thiếu userId.' });
  const banned = req.body?.banned !== false;
  const bannedUsers = new Set(theatre.bannedUsers || []);
  if (banned) {
    bannedUsers.add(userId);
    kickUserFromTheatre(theatre.id, userId);
  } else {
    bannedUsers.delete(userId);
  }
  store.updateTheatre(theatre.id, { bannedUsers: [...bannedUsers] });
  addAudit(req.user, banned ? 'theatre_ban' : 'theatre_unban', {
    theatreId: theatre.id,
    userId,
  });
  res.json({ ok: true, theatre: theatreView(theatre, true) });
});

app.post('/api/theatres/:id/kick', requireAuth, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  if (!canModerate(theatre, req.user)) {
    return res.status(403).json({ error: 'Bạn không có quyền đưa người ra khỏi rạp.' });
  }
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  if (!userId) return res.status(400).json({ error: 'Thiếu userId.' });
  kickUserFromTheatre(theatre.id, userId);
  addAudit(req.user, 'theatre_kick', { theatreId: theatre.id, userId });
  res.json({ ok: true });
});

app.post('/api/theatres/:id/appeal', requireAuth, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  if (theatre.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Chỉ chủ rạp được khiếu nại.' });
  }
  if (theatre.status !== 'rejected') {
    return res.status(400).json({ error: 'Rạp chưa bị từ chối.' });
  }
  const reason = cleanText(req.body?.reason, 300);
  store.updateTheatre(theatre.id, {
    status: 'pending_review',
    appeal: { reason, at: Date.now() },
  });
  store.logModeration({
    id: randomUUID(),
    at: Date.now(),
    userId: req.user.id,
    email: req.user.email,
    name: theatre.name,
    src: theatre.video.src,
    verdict: 'appealed',
    provider: 'admin',
    reason: reason || 'Chủ rạp khiếu nại.',
  });
  addAudit(req.user, 'theatre_appeal', { theatreId: theatre.id, reason });
  res.json({ ok: true, theatre: theatreView(theatre, true) });
});

app.post('/api/theatres/:id/mute', requireAuth, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  if (!canModerate(theatre, req.user)) {
    return res.status(403).json({ error: 'Bạn không có quyền tắt chat.' });
  }
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  if (!userId) return res.status(400).json({ error: 'Thiếu userId.' });
  const minutes = Math.max(0, Math.min(1440, Number(req.body?.minutes) || 0));
  const mutes = { ...(theatre.mutedUsers || {}) };
  if (minutes === 0) delete mutes[userId];
  else mutes[userId] = Date.now() + minutes * 60 * 1000;
  store.updateTheatre(theatre.id, { mutedUsers: mutes });
  addAudit(req.user, minutes === 0 ? 'unmute' : 'mute', {
    theatreId: theatre.id,
    userId,
    minutes,
  });
  res.json({ ok: true, theatre: theatreView(theatre, true) });
});

app.post('/api/theatres/:id/report', requireAuth, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  if (tooManyAttempts(REPORT_BUCKETS, req.user.id, 5, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Bạn đã gửi quá nhiều báo cáo. Thử lại sau.' });
  }
  const reason = cleanText(req.body?.reason, 500);
  if (!reason) return res.status(400).json({ error: 'Nhập lý do báo cáo.' });

  const report = {
    id: randomUUID(),
    at: Date.now(),
    theatreId: theatre.id,
    theatreName: theatre.name,
    reporterId: req.user.id,
    reporterEmail: req.user.email,
    targetUserId:
      typeof req.body?.targetUserId === 'string' ? req.body.targetUserId : null,
    reason,
    status: 'open',
  };
  store.data.reports.push(report);
  if (store.data.reports.length > 300) store.data.reports = store.data.reports.slice(-300);
  store.save();
  addAudit(req.user, 'report_create', { theatreId: theatre.id, reportId: report.id });
  res.status(201).json({ ok: true, report });
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
    strikes: user.strikes || 0,
  }));

  const theatres = store.listTheatres().map((theatre) => {
    const owner = store.findUserById(theatre.ownerId);
    return {
      ...theatreView(theatre, true),
      ownerEmail: owner?.email || '',
      video: { kind: theatre.video.kind },
    };
  });

  res.json({
    stats,
    users,
    theatres,
    moderation: [...store.data.moderation].reverse().slice(0, 100),
    reports: [...store.data.reports].reverse().slice(0, 100),
    audit: [...store.data.audit].reverse().slice(0, 200),
  });
});

app.patch('/api/admin/reports/:id', requireAuth, requireAdmin, (req, res) => {
  const report = store.data.reports.find((item) => item.id === req.params.id);
  if (!report) return res.status(404).json({ error: 'Không tìm thấy báo cáo.' });
  const status = req.body?.status === 'dismissed' ? 'dismissed' : 'resolved';
  report.status = status;
  report.resolvedAt = Date.now();
  report.resolvedBy = req.user.email;
  store.save();
  addAudit(req.user, status === 'resolved' ? 'report_resolve' : 'report_dismiss', {
    reportId: report.id,
  });
  res.json({ ok: true, report });
});

app.post('/api/admin/theatres/:id/review', requireAuth, requireAdmin, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  if (theatre.status !== 'pending_review') {
    return res.status(400).json({ error: 'Rạp không ở trạng thái chờ duyệt.' });
  }
  const approve = req.body?.approve !== false;
  const reason = cleanText(req.body?.reason, 300);

  if (approve) {
    store.updateTheatre(theatre.id, { status: 'open', appeal: null });
  } else {
    store.updateTheatre(theatre.id, { status: 'rejected', appeal: null });
    const owner = store.findUserById(theatre.ownerId);
    if (owner) {
      const strikes = (owner.strikes || 0) + 1;
      const patch = { strikes };
      if (strikes >= 3) {
        patch.banned = true;
        store.deleteSessionsForUser(owner.id);
        disconnectUser(owner.id);
      }
      store.updateUser(owner.id, patch);
    }
  }

  store.logModeration({
    id: randomUUID(),
    at: Date.now(),
    userId: req.user.id,
    email: req.user.email,
    name: theatre.name,
    src: theatre.video.src,
    verdict: approve ? 'approved' : 'rejected',
    provider: 'admin',
    reason: reason || (approve ? 'Quản trị viên duyệt.' : 'Quản trị viên từ chối.'),
  });
  addAudit(req.user, approve ? 'review_approve' : 'review_reject', {
    theatreId: theatre.id,
    reason,
  });
  res.json({ ok: true, theatre: theatreView(theatre, true) });
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
  addAudit(req.user, patch.banned === true ? 'user_ban' : patch.banned === false ? 'user_unban' : 'user_role', {
    targetUserId: target.id,
    targetEmail: target.email,
    role: patch.role,
  });
  res.json({ ok: true, user: publicUser(store.findUserById(target.id)) });
});

app.patch('/api/admin/theatres/:id', requireAuth, requireAdmin, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  const status = req.body?.status === 'closed' ? 'closed' : 'open';
  store.updateTheatre(theatre.id, { status });
  if (status === 'closed') closeLiveTheatre(theatre.id, 'Rạp đã bị quản trị viên đóng.');
  addAudit(req.user, status === 'closed' ? 'admin_theatre_close' : 'admin_theatre_open', {
    theatreId: theatre.id,
  });
  res.json({ ok: true, theatre: theatreView(theatre) });
});

app.delete('/api/admin/theatres/:id', requireAuth, requireAdmin, (req, res) => {
  const theatre = store.findTheatre(String(req.params.id || '').toUpperCase());
  if (!theatre) return res.status(404).json({ error: 'Không tìm thấy rạp.' });
  closeLiveTheatre(theatre.id, 'Rạp đã bị quản trị viên xoá.');
  store.updateTheatre(theatre.id, { status: 'deleted', deletedAt: Date.now() });
  addAudit(req.user, 'admin_theatre_trash', { theatreId: theatre.id, name: theatre.name });
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
    if (tooManyAttempts(JOIN_BUCKETS, socket.id, 20, 60000)) {
      return reply(ack, { ok: false, error: 'Bạn thử vào rạp quá nhiều lần. Đợi một lát.' });
    }
    const user = socket.data.user;
    const theatre = store.findTheatre(String(payload?.theatreId || '').toUpperCase());
    if (!theatre) return reply(ack, { ok: false, error: 'Không tìm thấy rạp này.' });
    if (theatre.status === 'pending_review') {
      return reply(ack, { ok: false, error: 'Rạp đang chờ quản trị viên duyệt.' });
    }
    if (theatre.status === 'rejected') {
      return reply(ack, { ok: false, error: 'Rạp đã bị từ chối kiểm duyệt.' });
    }
    if (theatre.status !== 'open') {
      return reply(ack, { ok: false, error: 'Rạp đang đóng.' });
    }
    const account = store.findUserById(user.id);
    if (theatre.mature && !account?.adultConfirmed) {
      return reply(ack, {
        ok: false,
        error: 'Rạp 18+ — cần xác nhận độ tuổi trong phần Tài khoản.',
      });
    }

    const existing = rooms.roomOf(socket.id);
    if (existing && existing.id !== theatre.id) leaveRoom(socket);

    const result = rooms.join(theatre, user, socket.id);
    if (result.error) return reply(ack, { ok: false, error: result.error });

    socket.join(theatre.id);
    store.updateTheatre(theatre.id, { lastActiveAt: Date.now() });
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

  socket.on('chat:send', (payload, ack) => {
    const room = rooms.roomOf(socket.id);
    if (!room) return reply(ack, { ok: false, error: 'Bạn chưa ở trong rạp.' });
    const user = room.users.get(socket.id);
    if (!user) return reply(ack, { ok: false, error: 'Không tìm thấy người dùng.' });
    const theatre = store.findTheatre(room.theatreId);
    if (!theatre) return reply(ack, { ok: false, error: 'Rạp không tồn tại.' });

    if (isMuted(theatre, user.accountId)) {
      return reply(ack, { ok: false, error: 'Bạn đang bị tắt chat trong rạp này.' });
    }

    const text = String(payload?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!text) return reply(ack, { ok: false, error: 'Tin nhắn trống.' });
    if (screenText(text)) {
      return reply(ack, { ok: false, error: 'Tin nhắn chứa nội dung bị chặn.' });
    }

    if (tooManyAttempts(CHAT_BUCKETS, socket.id, 8, 10000)) {
      const mutes = { ...(theatre.mutedUsers || {}), [user.accountId]: Date.now() + 60000 };
      store.updateTheatre(theatre.id, { mutedUsers: mutes });
      addAudit(null, 'chat_automute', {
        theatreId: theatre.id,
        userId: user.accountId,
        reason: 'spam',
      });
      return reply(ack, { ok: false, error: 'Bạn gửi quá nhanh — bị tắt chat 60 giây.' });
    }

    io.to(room.id).emit('chat:message', {
      id: `${socket.id}-${Date.now()}`,
      userId: socket.id,
      name: user.name,
      seatId: user.seatId,
      text,
      ts: Date.now(),
    });
    reply(ack, { ok: true });
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
    CHAT_BUCKETS.delete(socket.id);
    JOIN_BUCKETS.delete(socket.id);
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
  sweepTheatres();
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

const dbFlusher = setInterval(() => {
  if (store.dbDirty) {
    store.dbDirty = false;
    saveSnapshot('store', store.data).catch(() => {});
  }
}, 3000);
dbFlusher.unref?.();

if (fs.existsSync(indexFile)) {
  app.get(['/', '/index.html', '/admin', '/admin/'], (req, res) => res.sendFile(indexFile));
}

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Không tìm thấy.' });
  }
  res.status(404).type('text/plain').send('Không tìm thấy trang.');
});

app.use((err, req, res, next) => {
  console.error('[http]', err?.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Lỗi máy chủ.' });
});

(async () => {
  try {
    await Promise.race([
      initDb(),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
    if (isDbConnected()) {
      const snapshot = await loadSnapshot('store');
      if (snapshot) store.loadData(snapshot);
    }
  } catch (error) {
    console.warn('[db] bỏ qua khởi tạo Postgres:', error.message);
  }
  seedAdmin();
  server.listen(PORT, () => {
    console.log(`Virtual Cinema API đang chạy tại http://localhost:${PORT}`);
    console.log(`Trang quản trị: http://localhost:${PORT}/admin`);
    console.log(`Dữ liệu: ${dataDir}${isDbConnected() ? ' (+ Postgres)' : ''}`);
  });
})();

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] nhận ${signal}, đang lưu trạng thái…`);
  try {
    if (isDbConnected()) await saveSnapshot('store', store.data);
  } catch {
    /* ignore */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref?.();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
