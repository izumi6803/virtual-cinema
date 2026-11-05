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
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ADMIN_EMAIL, ADMIN_PASSWORD },
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
      if ((await fetch(`${BASE}/health`)).ok) return;
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

const connect = (token) =>
  new Promise((resolve, reject) => {
    const socket = io(BASE, { transports: ['websocket'], auth: { token } });
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

const register = async (email, name, password = 'password1') =>
  (await request('POST', '/api/auth/register', { body: { email, password, name } })).data;

try {
  await waitForServer();

  const u1 = await register('u1@test.io', 'Chủ rạp');
  const u2 = await register('u2@test.io', 'Moderator');
  const u3 = await register('u3@test.io', 'Khách mời');
  check('đăng ký 3 người dùng', u1.token && u2.token && u3.token);

  const dup = await request('POST', '/api/auth/register', {
    body: { email: 'u1@test.io', password: 'password1', name: 'Trùng' },
  });
  check('chặn email trùng', dup.status === 409);

  const badLogin = await request('POST', '/api/auth/login', {
    body: { email: 'u1@test.io', password: 'wrong' },
  });
  check('chặn sai mật khẩu', badLogin.status === 401);

  const admin = (await request('POST', '/api/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })).data;
  check('đăng nhập admin', admin.user.role === 'admin');

  const noAuth = await request('GET', '/api/theatres');
  check('chặn chưa đăng nhập', noAuth.status === 401);

  // --- create open theatre ---
  const pub = await request('POST', '/api/theatres', {
    token: u1.token,
    body: { name: 'Rạp công khai', visibility: 'public', video: { kind: 'html5', src: 'https://example.com/m.mp4' } },
  });
  check('tạo rạp công khai (open)', pub.status === 201 && pub.data.theatre.status === 'open');

  // --- blocked by banned domain ---
  const hard = await request('POST', '/api/theatres', {
    token: u1.token,
    body: { name: 'Phim lậu', video: { kind: 'html5', src: 'https://pornhub.com/x.mp4' } },
  });
  check('chặn cứng theo tên miền', hard.status === 422);

  // --- flagged -> pending review ---
  const flagged = await request('POST', '/api/theatres', {
    token: u1.token,
    body: { name: 'Phim sex 18+', video: { kind: 'html5', src: 'https://example.com/s.mp4' } },
  });
  check('từ khoá -> chờ duyệt', flagged.status === 201 && flagged.data.theatre.status === 'pending_review');
  const flaggedId = flagged.data.theatre.id;

  const listU2 = await request('GET', '/api/theatres', { token: u2.token });
  const ids = listU2.data.theatres.map((theatre) => theatre.id);
  check('khách không thấy rạp chờ duyệt', !ids.includes(flaggedId));

  const socket1 = await connect(u1.token);
  const joinPending = await call(socket1, 'room:join', { theatreId: flaggedId });
  check('chặn join rạp chờ duyệt', joinPending.ok === false && /chờ|duyệt/.test(joinPending.error));

  // --- reject -> strike ---
  const rej = await request('POST', `/api/admin/theatres/${flaggedId}/review`, {
    token: admin.token,
    body: { approve: false, reason: 'Nội dung không phù hợp' },
  });
  check('admin từ chối', rej.status === 200 && rej.data.theatre.status === 'rejected');
  const ov1 = await request('GET', '/api/admin/overview', { token: admin.token });
  const strikes1 = ov1.data.users.find((user) => user.email === 'u1@test.io').strikes;
  check('từ chối -> cộng strike', strikes1 === 1);

  // --- appeal ---
  const appeal = await request('POST', `/api/theatres/${flaggedId}/appeal`, {
    token: u1.token,
    body: { reason: 'Phim thật ra không vi phạm' },
  });
  check('chủ rạp khiếu nại', appeal.status === 200 && appeal.data.theatre.status === 'pending_review');

  // --- approve ---
  const appr = await request('POST', `/api/admin/theatres/${flaggedId}/review`, {
    token: admin.token,
    body: { approve: true },
  });
  check('admin duyệt sau khiếu nại', appr.status === 200 && appr.data.theatre.status === 'open');

  // --- host override ---
  await request('PATCH', `/api/theatres/${pub.data.theatre.id}`, {
    token: u1.token,
    body: { hostOverride: u3.user.id },
  });
  const socket3 = await connect(u3.token);
  const join3 = await call(socket3, 'room:join', { theatreId: pub.data.theatre.id });
  check('uỷ quyền host', join3.room.hostId === socket3.id);

  // --- moderator can kick ---
  await request('POST', `/api/theatres/${pub.data.theatre.id}/moderators`, {
    token: u1.token,
    body: { userId: u2.user.id, action: 'add' },
  });
  const kicked = new Promise((resolve) => {
    socket3.on('disconnect', () => resolve(true));
    socket3.on('room:kicked', () => resolve(true));
  });
  await request('POST', `/api/theatres/${pub.data.theatre.id}/kick`, {
    token: u2.token,
    body: { userId: u3.user.id },
  });
  check('moderator kick người dùng', (await Promise.race([kicked, sleep(3000).then(() => false)])) === true);

  // --- ban from theatre ---
  await request('POST', `/api/theatres/${pub.data.theatre.id}/ban`, {
    token: u1.token,
    body: { userId: u3.user.id, banned: true },
  });
  const socket3b = await connect(u3.token);
  const joinBanned = await call(socket3b, 'room:join', { theatreId: pub.data.theatre.id });
  check('cấm user khỏi rạp', joinBanned.ok === false && /cấm/.test(joinBanned.error));

  // --- global ban ---
  await request('PATCH', `/api/admin/users/${u2.user.id}`, {
    token: admin.token,
    body: { banned: true },
  });
  const relogin = await request('POST', '/api/auth/login', {
    body: { email: 'u2@test.io', password: 'password1' },
  });
  check('chặn đăng nhập tài khoản khoá', relogin.status === 403);

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
  socket3b.disconnect();
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
