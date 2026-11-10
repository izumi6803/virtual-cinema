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

  const bypass = await request('PATCH', `/api/theatres/${flaggedId}`, {
    token: u1.token,
    body: { status: 'open' },
  });
  check('không thể tự mở rạp chờ duyệt', bypass.status === 409);

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
  check(
    'phòng trả accountId + moderators',
    join3.room.users.some((member) => member.accountId === u3.user.id) &&
      Array.isArray(join3.room.moderators),
  );

  // --- chat moderation ---
  const badChat = await call(socket3, 'chat:send', { text: 'noi dung porn' });
  check('chat lọc từ khoá', badChat.ok === false);

  await request('POST', `/api/theatres/${pub.data.theatre.id}/mute`, {
    token: u1.token,
    body: { userId: u3.user.id, minutes: 10 },
  });
  const mutedChat = await call(socket3, 'chat:send', { text: 'xin chào' });
  check('chat bị mute', mutedChat.ok === false && /tắt chat/.test(mutedChat.error));
  await request('POST', `/api/theatres/${pub.data.theatre.id}/mute`, {
    token: u1.token,
    body: { userId: u3.user.id, minutes: 0 },
  });

  // --- report ---
  const report = await request('POST', `/api/theatres/${pub.data.theatre.id}/report`, {
    token: u3.token,
    body: { reason: 'Nội dung thử nghiệm' },
  });
  check('gửi báo cáo', report.status === 201);
  let lastReport;
  for (let index = 0; index < 5; index += 1) {
    lastReport = await request('POST', `/api/theatres/${pub.data.theatre.id}/report`, {
      token: u3.token,
      body: { reason: `Spam ${index}` },
    });
  }
  check('giới hạn báo cáo', lastReport.status === 429);

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

  const ov2 = await request('GET', '/api/admin/overview', { token: admin.token });
  check('admin thấy báo cáo', ov2.data.reports.some((item) => item.id === report.data.report.id));
  const resolve = await request('PATCH', `/api/admin/reports/${report.data.report.id}`, {
    token: admin.token,
    body: { status: 'resolved' },
  });
  check('xử lý báo cáo', resolve.status === 200);
  check('audit log có sự kiện', ov2.data.audit.length > 0);

  // --- mature gate ---
  const matureTheatre = await request('POST', '/api/theatres', {
    token: u1.token,
    body: { name: 'Rạp người lớn', mature: true, video: { kind: 'html5', src: 'https://example.com/m.mp4' } },
  });
  check('tạo rạp 18+', matureTheatre.status === 201 && matureTheatre.data.theatre.mature === true);

  const u5 = await register('u5@test.io', 'Người 5');
  const socket5 = await connect(u5.token);
  const joinMature = await call(socket5, 'room:join', { theatreId: matureTheatre.data.theatre.id });
  check('chặn join rạp 18+ chưa xác nhận', joinMature.ok === false && /18\+/.test(joinMature.error));

  await request('POST', '/api/account/adult', { token: u5.token, body: { confirmed: true } });
  const joinMature2 = await call(socket5, 'room:join', { theatreId: matureTheatre.data.theatre.id });
  check('join rạp 18+ sau khi xác nhận', joinMature2.ok === true);
  socket5.emit('room:leave');
  await sleep(300);

  // --- soft delete + restore ---
  const tempTheatre = await request('POST', '/api/theatres', {
    token: u5.token,
    body: { name: 'Rạp tạm 5', video: { kind: 'html5', src: 'https://example.com/t5.mp4' } },
  });
  const delSoft = await request('DELETE', `/api/theatres/${tempTheatre.data.theatre.id}`, {
    token: u5.token,
  });
  check('xoá mềm (thùng rác)', delSoft.status === 200);
  const listAfterDelete = await request('GET', '/api/theatres', { token: u5.token });
  const deletedEntry = listAfterDelete.data.theatres.find(
    (item) => item.id === tempTheatre.data.theatre.id,
  );
  check('rạp trong thùng rác của chủ', deletedEntry && deletedEntry.status === 'deleted');

  const restore = await request('POST', `/api/theatres/${tempTheatre.data.theatre.id}/restore`, {
    token: u5.token,
  });
  check('khôi phục rạp', restore.status === 200 && restore.data.theatre.status === 'open');

  // --- transfer ---
  const transfer = await request('POST', `/api/theatres/${tempTheatre.data.theatre.id}/transfer`, {
    token: u5.token,
    body: { email: 'u1@test.io' },
  });
  check('chuyển nhượng rạp', transfer.status === 200);
  const u1List = await request('GET', '/api/theatres', { token: u1.token });
  check('chủ mới thấy rạp', u1List.data.theatres.some((item) => item.id === tempTheatre.data.theatre.id));
  const u5List = await request('GET', '/api/theatres', { token: u5.token });
  const u5Entry = u5List.data.theatres.find((item) => item.id === tempTheatre.data.theatre.id);
  check('chủ cũ không còn sở hữu', u5Entry && u5Entry.owner.id !== u5.user.id);

  const bannedTransfer = await request('POST', `/api/theatres/${tempTheatre.data.theatre.id}/transfer`, {
    token: u1.token,
    body: { email: 'u2@test.io' },
  });
  check('không chuyển cho tài khoản khoá', bannedTransfer.status === 400);

  // --- change password ---
  const otherLogin = await request('POST', '/api/auth/login', {
    body: { email: 'u5@test.io', password: 'password1' },
  });
  const otherToken = otherLogin.data.token;
  const pwChange = await request('POST', '/api/account/password', {
    token: u5.token,
    body: { currentPassword: 'password1', newPassword: 'newpassword2' },
  });
  check('đổi mật khẩu', pwChange.status === 200);
  const revoked = await request('GET', '/api/auth/me', { token: otherToken });
  check('đổi mật khẩu thu hồi phiên khác', revoked.status === 401);
  const kept = await request('GET', '/api/auth/me', { token: u5.token });
  check('giữ phiên hiện tại', kept.status === 200);
  const newLogin = await request('POST', '/api/auth/login', {
    body: { email: 'u5@test.io', password: 'newpassword2' },
  });
  check('đăng nhập mật khẩu mới', newLogin.status === 200);
  const oldLogin = await request('POST', '/api/auth/login', {
    body: { email: 'u5@test.io', password: 'password1' },
  });
  check('mật khẩu cũ bị từ chối', oldLogin.status === 401);
  socket5.disconnect();

  // --- health ---
  const health = await request('GET', '/health');
  check(
    'health chi tiết',
    health.status === 200 && typeof health.data.rooms === 'number' && 'db' in health.data,
  );

  // --- account deletion (GDPR) ---
  const u4 = await register('u4@test.io', 'Xoá tài khoản');
  const u4Theatre = await request('POST', '/api/theatres', {
    token: u4.token,
    body: { name: 'Rạp tạm', video: { kind: 'html5', src: 'https://example.com/t.mp4' } },
  });
  const del = await request('DELETE', '/api/account', {
    token: u4.token,
    body: { password: 'password1' },
  });
  check('xoá tài khoản', del.status === 200);
  const u4Login = await request('POST', '/api/auth/login', {
    body: { email: 'u4@test.io', password: 'password1' },
  });
  check('tài khoản đã xoá không đăng nhập được', u4Login.status === 401);
  const ov3 = await request('GET', '/api/admin/overview', { token: admin.token });
  check(
    'rạp của tài khoản đã xoá bị gỡ',
    !ov3.data.theatres.some((item) => item.id === u4Theatre.data.theatre.id),
  );

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
