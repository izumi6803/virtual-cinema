import { useState } from 'react';

export default function AuthScreen({ auth, admin = false }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'register') {
        await auth.register(email.trim(), password, name.trim());
      } else {
        await auth.login(email.trim(), password);
      }
    } catch (err) {
      setError(err.message || 'Không đăng nhập được.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="lobby">
      <div className="lobby__grid">
        <section className="poster">
          <div className="marquee" aria-hidden="true">
            {Array.from({ length: 16 }).map((_, index) => (
              <span key={index} style={{ animationDelay: `${(index % 4) * 0.6}s` }} />
            ))}
          </div>

          <p className="eyebrow">
            <span className="eyebrow__dot" />
            {admin ? 'Virtual Cinema · Quản trị' : 'Virtual Cinema · Sảnh rạp'}
          </p>

          <h1 className="display">
            {admin ? 'Bảng điều khiển.' : 'Đăng nhập.'}
            <br />
            <em>{admin ? 'Giữ rạp trong tầm tay.' : 'Để vào rạp.'}</em>
          </h1>

          <p className="lede">
            {admin
              ? 'Xem số người đang dùng, quản lý rạp, tài khoản và các phim bị kiểm duyệt chặn.'
              : 'Tạo tài khoản để mở rạp riêng, mời người khác bằng mã 6 ký tự và xem phim đồng bộ cùng nhau.'}
          </p>

          <ul className="poster__facts">
            <li>
              <span className="bullet" />
              Rạp công khai trong sảnh, hoặc riêng tư bằng mã.
            </li>
            <li>
              <span className="bullet" />
              Mỗi rạp có một người điều khiển phim.
            </li>
            <li>
              <span className="bullet" />
              Phim được kiểm duyệt metadata trước khi mở rạp.
            </li>
          </ul>
        </section>

        <section className="entry">
          {admin ? null : (
            <div className="tabs" role="tablist" aria-label="Đăng nhập hoặc đăng ký">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                className={mode === 'login' ? 'is-active' : ''}
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
              >
                Đăng nhập
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={mode === 'register' ? 'is-active' : ''}
                onClick={() => {
                  setMode('register');
                  setError('');
                }}
              >
                Tạo tài khoản
              </button>
            </div>
          )}

          {admin ? <h2 className="entry__title">Đăng nhập quản trị</h2> : null}

          <form className="form" onSubmit={submit}>
            {mode === 'register' ? (
              <label className="field">
                <span>Tên hiển thị</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ví dụ: Linh"
                  maxLength={32}
                  autoComplete="nickname"
                />
              </label>
            ) : null}

            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="ban@example.com"
                autoComplete="email"
                spellCheck={false}
              />
            </label>

            <label className="field">
              <span>Mật khẩu</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === 'register' ? 'Ít nhất 8 ký tự' : '••••••••'}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              />
            </label>

            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}

            <button className="btn btn--primary" type="submit" disabled={busy}>
              {busy ? 'Đang xử lý…' : mode === 'register' ? 'Tạo tài khoản' : 'Đăng nhập'}
            </button>
          </form>

          <p className="entry__foot">
            {admin
              ? 'Chỉ tài khoản có quyền quản trị mới vào được trang này.'
              : 'Tài khoản quản trị do hệ thống cấp.'}
          </p>
        </section>
      </div>
    </main>
  );
}
