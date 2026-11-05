import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '../../server');
const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = 'admin@test.io';
const ADMIN_PASSWORD = 'adminpass1';

const dataDir = mkdtempSync(path.join(tmpdir(), 'vc-e2e-'));
const child = spawn(process.execPath, ['src/index.js'], {
  cwd: serverDir,
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR: dataDir,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

const results = [];
const check = (label, condition, extra = '') => {
  results.push({ label, ok: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      /* not ready */
    }
    await sleep(200);
  }
  throw new Error('server did not start');
}

async function request(method, pathName, { token, body } = {}) {
  const response = await fetch(`${BASE}${pathName}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

const call = (socket, event, payload) =>
  new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, payload, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });

const connect = (token) => {
  const socket = io(BASE, { transports: ['websocket'], auth: { token } });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), 5000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
};

try {
  await waitForServer();

  const reg = await request('POST', '/api/auth/register', {
    body: { email: 'user1@test.io', password: 'password1', name: 'Người 1' },
  });
  check('đăng ký', reg.status === 201 && reg.data.token && reg.data.user.role === 'user');
  const token1 = reg.data.token;

  const dup = await request('POST', '/api/auth/register', {
    body: { email: 'user1@test.io', password: 'password1', name: 'Trùng' },
  });
  check('chặn email trùng', dup.status === 409);

  const short = await request('POST', '/api/auth/register', {
    body: { email: 'x@test.io', password: '123', name: 'X' },
  });
  check('chặn mật khẩu ngắn', short.status === 400);

  const badLogin = await request('POST', '/api/auth/login', {
    body: { email: 'user1@test.io', password: 'wrongpass' },
  });
  check('chặn sai mật khẩu', badLogin.status === 401);

  const login = await request('POST', '/api/auth/login', {
    body: { email: 'user1@test.io', password: 'password1' },
  });
  check('đăng nhập', login.status === 200 && login.data.user.email === 'user1@test.io');

  const me = await request('GET', '/api/auth/me', { token: token1 });
  check('lấy hồ sơ', me.status === 200 && me.data.user.id === login.data.user.id);

  const adminLogin = await request('POST', '/api/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  check('đăng nhập admin', adminLogin.status === 200 && adminLogin.data.user.role === 'admin');
  const adminToken = adminLogin.data.token;

  const noAuth = await request('GET', '/api/theatres');
  check('chặn chưa đăng nhập', noAuth.status === 401);

  const created = await request('POST', '/api/theatres', {
    token: token1,
    body: {
      name: 'Rạp công khai',
      visibility: 'public',
      video: { kind: 'html5', src: 'https://example.com/movie.mp4' },
    },
  });
  check('tạo rạp công khai', created.status === 201 && created.data.theatre.id, created.data.theatre?.id);
  const publicId = created.data.theatre.id;

  const blocked = await request('POST', '/api/theatres', {
    token: token1,
    body: {
      name: 'Phim sex porn',
      visibility: 'public',
      video: { kind: 'html5', src: 'https://example.com/x.mp4' },
    },
  });
  check('kiểm duyệt chặn từ khoá', blocked.status === 422 && blocked.data.reason, blocked.data.reason);

  const privateCreated = await request('POST', '/api/theatres', {
    token: token1,
    body: {
      name: 'Rạp riêng',
      visibility: 'private',
      video: { kind: 'youtube', src: 'https://youtu.be/aqz-KE-bpKQ' },
    },
  });
  check('tạo rạp riêng', privateCreated.status === 201);
  const privateId = privateCreated.data.theatre.id;

  const reg2 = await request('POST', '/api/auth/register', {
    body: { email: 'user2@test.io', password: 'password2', name: 'Người 2' },
  });
  const token2 = reg2.data.token;

  const list2 = await request('GET', '/api/theatres', { token: token2 });
  const ids = list2.data.theatres.map((theatre) => theatre.id);
  check('danh sách rạp', list2.status === 200 && ids.includes(publicId));
  check('ẩn rạp riêng của người khác', !ids.includes(privateId));

  const socket1 = await connect(token1);
  const join1 = await call(socket1, 'room:join', { theatreId: publicId });
  check('join rạp qua socket', join1.ok && join1.room.name === 'Rạp công khai');

  const seat = await call(socket1, 'seat:claim', { seatId: '1-2' });
  check('chọn ghế', seat.ok);

  const socket2 = await connect(token2);
  const joinPrivate = await call(socket2, 'room:join', { theatreId: privateId });
  check('join rạp riêng bằng mã', joinPrivate.ok, privateId);

  let closedEvent = null;
  socket2.on('room:closed', (payload) => {
    closedEvent = payload;
  });

  const overview = await request('GET', '/api/admin/overview', { token: adminToken });
  check('admin xem tổng quan', overview.status === 200 && overview.data.users.length >= 3);
  check(
    'admin thấy log kiểm duyệt',
    overview.data.moderation.some((entry) => entry.verdict === 'blocked'),
  );
  const target = overview.data.users.find((user) => user.email === 'user2@test.io');

  const closeTheatre = await request('PATCH', `/api/admin/theatres/${privateId}`, {
    token: adminToken,
    body: { status: 'closed' },
  });
  check('admin đóng rạp', closeTheatre.status === 200);
  await sleep(600);
  check('người trong rạp nhận room:closed', Boolean(closedEvent));

  const ban = await request('PATCH', `/api/admin/users/${target.id}`, {
    token: adminToken,
    body: { banned: true },
  });
  check('admin khoá tài khoản', ban.status === 200 && ban.data.user.banned === true);

  const relogin = await request('POST', '/api/auth/login', {
    body: { email: 'user2@test.io', password: 'password2' },
  });
  check('chặn đăng nhập tài khoản đã khoá', relogin.status === 403);

  let unauthorized = false;
  await new Promise((resolve) => {
    const bad = io(BASE, { transports: ['websocket'], auth: { token: 'bogus' } });
    bad.on('connect_error', (error) => {
      unauthorized = error.message === 'unauthorized';
      bad.disconnect();
      resolve();
    });
  });
  check('chặn socket token sai', unauthorized);

  socket1.disconnect();
  socket2.disconnect();
} catch (error) {
  console.error('E2E ERROR:', error.message);
  results.push({ label: 'unexpected error', ok: false });
} finally {
  child.kill();
  await sleep(300);
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

if (stderr.trim()) console.error('--- server stderr ---\n', stderr);

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} kiểm tra đạt.`);
process.exit(failed.length === 0 ? 0 : 1);
