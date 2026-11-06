# Virtual Cinema

Rạp chiếu phim ảo 3D trong trình duyệt: tài khoản, sảnh rạp, chọn ghế, xem phim đồng bộ, chat theo vùng, voice không gian và kiểm duyệt phim bằng AI.

## Tính năng

- **Tài khoản** (email + mật khẩu, hash bằng `scrypt`, token phiên 7 ngày): đăng ký, đăng nhập, đăng xuất.
- **Sảnh rạp**: sau khi đăng nhập thấy danh sách rạp công khai + rạp riêng của mình; vào nhanh bằng mã 6 ký tự.
- **Rạp persistent**: mỗi rạp có tên, chủ rạp, nguồn phim, chế độ công khai/riêng tư, trạng thái mở/đóng. Rạp không biến mất khi hết người.
- **Phòng chiếu 3D** (Three.js): 60 ghế, avatar, camera theo ghế, đèn rạp, màn hình phát video.
- **Đồng bộ video** server-authoritative: play, pause, seek; bù lệch đồng hồ + hiệu chỉnh drift.
- **Hai adapter nguồn phim**: MP4 (`VideoTexture`) và YouTube (iframe phủ màn hình).
- **Chat theo vùng**: tin nhắn chỉ hiện với người ngồi gần.
- **Voice WebRTC mesh + spatial audio** (HRTF): mọi người ở chế độ nghe, chỉ người nói cần bật micro.
- **Trang quản trị** `/admin`: người online, rạp, tài khoản (khoá/mở, nâng/hạ quyền), log kiểm duyệt.
- **Kiểm duyệt phim** tự động theo metadata: blocklist local + adapter OpenAI (`omni-moderation-latest`).

## Yêu cầu

- Node.js 18+.
- Trình duyệt hiện đại (Chrome, Edge, Firefox, Safari).
- Micro + HTTPS hoặc `localhost` cho voice.

## Chạy

```bash
npm run install:all
npm run dev
```

- Giao diện: http://localhost:5173
- Quản trị: http://localhost:5173/admin
- API + Socket.io: http://localhost:3001

Production:

```bash
npm run build
npm start
```

## Biến môi trường

| Biến | Mặc định | Mô tả |
| --- | --- | --- |
| `PORT` | `3001` | Cổng API. |
| `DATA_DIR` | `server/data` | Nơi lưu `db.json` (tài khoản, rạp, session) và `stats.json`. |
| `DATABASE_URL` | *(trống)* | Chuỗi kết nối Postgres. Nếu có, server lưu snapshot trạng thái vào bảng `app_state` (giữ dữ liệu qua các lần deploy); không có thì dùng file JSON. |
| `ADMIN_EMAIL` | `admin@example.com` | Email tài khoản quản trị (tạo khi khởi động nếu chưa có). |
| `ADMIN_PASSWORD` | `admin12345` | Mật khẩu quản trị mặc định — **đổi trước khi deploy**. |
| `OPENAI_API_KEY` | *(trống)* | Nếu có, kiểm duyệt dùng Moderation API; nếu không dùng blocklist local. |
| `MODERATION_TERMS` | *(danh sách sẵn)* | Danh sách từ khoá cấm, phân cách bằng dấu phẩy. |

Ví dụ (PowerShell):

```powershell
$env:ADMIN_EMAIL="admin@tenmien.com"; $env:ADMIN_PASSWORD="mat-khau-manh"; $env:OPENAI_API_KEY="sk-..."; npm.cmd start
```

## Cách dùng

1. Đăng ký tài khoản (tên + email + mật khẩu).
2. Tạo rạp mới (tên, mô tả, nguồn phim, công khai/riêng tư). Hệ thống kiểm duyệt metadata trước khi mở.
3. Chia sẻ **mã 6 ký tự** để người khác vào rạp riêng; rạp công khai hiện ngay trong sảnh.
4. Chọn ghế; chủ rạp điều khiển phim.
5. Chat chỉ hiện với người ngồi gần; bật micro để nói (người nghe không cần bật).

Tài khoản quản trị mặc định (dev): `admin@example.com` / `admin12345` — đổi qua `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

## Kiến trúc

```
server/
  src/index.js        Express + Socket.io: auth, theatres CRUD, admin, socket auth
  src/store.js        Lưu JSON (users, theatres, sessions, moderation)
  src/auth.js         scrypt, token, session
  src/moderation.js   Blocklist local + adapter OpenAI
  src/rooms.js        Phòng live theo theatre, ghế, host, đồng hồ video
  src/metrics.js      Thống kê khách/phiên theo ngày

client/
  src/App.jsx               Lobby flow (auth → theatre list → cinema)
  src/components/AuthScreen.jsx
  src/components/TheatreList.jsx
  src/components/CinemaView.jsx
  src/components/AdminApp.jsx / AdminView.jsx
  src/net/api.js            HTTP client
  src/net/socket.js         Socket auth
  src/net/voice.js          Mesh WebRTC + spatial audio
  src/video/                Adapter MP4 / YouTube
  src/three/                Dựng rạp, ghế, avatar, camera
```

### Đồng bộ video

Server giữ `{ playing, baseTime, baseAt }`; client tính `baseTime + (serverNow() - baseAt)/1000`. `serverNow()` dùng offset đo qua 5 ping `time:sync`. Client tự seek nếu lệch > 1.4 s.

### Voice

Mọi người trong rạp tham gia mesh ở chế độ nghe (`recvonly`); bật micro sẽ dựng lại peer connection với track thật (perfect negotiation). Mỗi remote stream có một thẻ `<audio>` ẩn để Chrome giải mã, còn Web Audio đảm nhiệm spatial + đo mức. Xem thêm `src/net/voice.js`.

### Kiểm duyệt

Khi tạo rạp, server kiểm tra tên/mô tả/URL:
1. Blocklist local (từ khoá + tên miền) → chặn ngay.
2. Nếu có `OPENAI_API_KEY` → gọi Moderation API → chặn nếu `flagged`.

Mọi lần kiểm tra đều ghi vào log để admin xem ở `/admin`.

## Kiểm thử

```bash
npm test
```

Bộ test e2e tự dựng server trên cổng 3100 với `DATA_DIR` tạm, kiểm tra 19 bước: đăng ký/đăng nhập, chặn email trùng, kiểm duyệt (chặn tên miền / chờ duyệt từ khoá), quyền vào rạp, chờ duyệt/khiếu nại/duyệt lại, strike, uỷ quyền host, moderator kick, ban theo rạp, admin khoá tài khoản, socket không hợp lệ.

## CI/CD

- `.github/workflows/deploy.yml`: mỗi push/PR chạy e2e; khi push vào `main` và test pass thì trigger deploy Render qua API.
- Cần secret `RENDER_API_KEY` (GitHub → **Settings → Secrets and variables → Actions**). Service ID đã cấu hình sẵn trong workflow.
- Nếu dùng workflow này, nên tắt **Auto-Deploy** trên Render (Settings → Deploy) để tránh deploy 2 lần.
- CLI Render: cài bằng `winget install render.cli` hoặc tải binary từ https://github.com/render-oss/cli/releases; đặt `RENDER_API_KEY` rồi dùng `render deploys create <service-id> --confirm`.

## Giới hạn đã biết

- **Lưu trữ JSON**: phù hợp demo/quy mô nhỏ; chưa có rate-limit chi tiết, xác minh email hay khôi phục mật khẩu. Token trong `localStorage` (dễ bị XSS). Có thể cấu hình `DATABASE_URL` (Postgres) để lưu snapshot trạng thái và giữ dữ liệu qua các lần deploy.
- **CORS video**: MP4 phải có CORS (đặt file vào `client/public/` để cùng origin). HLS cần `hls.js` trên Chrome.
- **YouTube**: overlay hình chữ nhật, có thể cần bấm “Bấm để phát phim” do autoplay.
- **Voice**: chỉ STUN (chưa TURN), mesh phù hợp ≤ ~10 người; cần HTTPS trên LAN.
- **Kiểm duyệt**: chỉ metadata; không phân tích nội dung/frame video.

## Hướng mở rộng

- TURN/SFU (mediasoup/LiveKit) cho voice đông người.
- Xác minh email, khôi phục mật khẩu, OAuth.
- Kiểm duyệt frame video bằng API vision, hàng chờ duyệt phim.
- Đổi phim giữa chừng, phụ đề, reaction trên ghế.
- Redis/Postgres thay cho JSON store.
