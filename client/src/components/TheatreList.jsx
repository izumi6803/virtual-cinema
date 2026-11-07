import { useCallback, useEffect, useState } from 'react';
import { api } from '../net/api.js';
import { socket } from '../net/socket.js';

const SAMPLE_MP4 =
  'https://cdn.jsdelivr.net/gh/mediaelement/mediaelement-files@master/big_buck_bunny.mp4';
const SAMPLE_YOUTUBE = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

export default function TheatreList({ auth, onEnter }) {
  const { token, user } = auth;
  const [theatres, setTheatres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState({ message: '', reason: '' });
  const [form, setForm] = useState({
    name: '',
    description: '',
    kind: 'html5',
    src: SAMPLE_MP4,
    visibility: 'public',
    mature: false,
  });
  const [accountMsg, setAccountMsg] = useState('');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await api('/api/theatres', { token });
      setTheatres(data.theatres);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 8000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  function joinTheatre(theatreId) {
    const id = String(theatreId || '').trim().toUpperCase();
    if (!id) {
      setError('Nhập mã rạp để vào.');
      return;
    }
    if (joining) return;
    setJoining(true);
    setError('');
    socket.timeout(6000).emit('room:join', { theatreId: id }, (timeoutError, response) => {
      setJoining(false);
      if (timeoutError) {
        setError('Máy chủ không phản hồi.');
        return;
      }
      if (!response?.ok) {
        if (/18\+/.test(response?.error || '')) {
          confirmAdultAndJoin(id);
          return;
        }
        setError(response?.error || 'Không vào được rạp.');
        return;
      }
      onEnter(response.room);
    });
  }

  async function confirmAdultAndJoin(id) {
    if (!window.confirm('Rạp này gắn nhãn 18+. Bạn xác nhận mình đủ 18 tuổi?')) {
      setError('Bạn cần xác nhận đủ 18 tuổi trong phần Tài khoản.');
      return;
    }
    try {
      await api('/api/account/adult', { method: 'POST', token, body: { confirmed: true } });
    } catch (err) {
      setError(err.message);
      return;
    }
    joinTheatre(id);
  }

  async function createTheatre(event) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setFormError({ message: '', reason: '' });
    try {
      const data = await api('/api/theatres', {
        method: 'POST',
        token,
        body: {
          name: form.name.trim(),
          description: form.description.trim(),
          visibility: form.visibility,
          mature: form.mature,
          video: { kind: form.kind, src: form.src.trim() },
        },
      });
      if (data.theatre.status === 'pending_review') {
        setNotice(`Rạp ${data.theatre.id} đang chờ quản trị viên duyệt phim.`);
      } else {
        setNotice(`Đã tạo rạp ${data.theatre.id}.`);
      }
      setForm((previous) => ({ ...previous, name: '', description: '' }));
      await refresh();
      if (data.theatre.status === 'open') joinTheatre(data.theatre.id);
    } catch (err) {
      setFormError({ message: err.message, reason: err.reason });
    } finally {
      setCreating(false);
    }
  }

  async function updateStatus(theatre, status) {
    if (status === 'closed' && !window.confirm(`Đóng rạp "${theatre.name}"?`)) return;
    try {
      await api(`/api/theatres/${theatre.id}`, { method: 'PATCH', token, body: { status } });
      setNotice(status === 'closed' ? 'Đã đóng rạp.' : 'Đã mở lại rạp.');
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function appealTheatre(theatre) {
    const reason = window.prompt(`Lý do khiếu nại cho rạp "${theatre.name}":`);
    if (reason == null) return;
    try {
      await api(`/api/theatres/${theatre.id}/appeal`, {
        method: 'POST',
        token,
        body: { reason },
      });
      setNotice('Đã gửi khiếu nại. Rạp sẽ được quản trị viên xem lại.');
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeTheatre(theatre) {
    if (!window.confirm(`Chuyển rạp "${theatre.name}" vào thùng rác?`)) return;
    try {
      await api(`/api/theatres/${theatre.id}`, { method: 'DELETE', token });
      setNotice('Đã chuyển rạp vào thùng rác (khôi phục được trong 30 ngày).');
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function restoreTheatre(theatre) {
    try {
      await api(`/api/theatres/${theatre.id}/restore`, { method: 'POST', token });
      setNotice('Đã khôi phục rạp.');
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function transferTheatre(theatre) {
    const email = window.prompt(`Email người nhận rạp "${theatre.name}":`);
    if (!email) return;
    try {
      await api(`/api/theatres/${theatre.id}/transfer`, {
        method: 'POST',
        token,
        body: { email },
      });
      setNotice('Đã chuyển nhượng rạp.');
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setAccountMsg('');
    try {
      await api('/api/account/password', {
        method: 'POST',
        token,
        body: { currentPassword: currentPw, newPassword: newPw },
      });
      setAccountMsg('Đã đổi mật khẩu.');
      setCurrentPw('');
      setNewPw('');
    } catch (err) {
      setAccountMsg(err.message);
    }
  }

  async function confirmAdultAccount() {
    try {
      await api('/api/account/adult', { method: 'POST', token, body: { confirmed: true } });
      setAccountMsg('Đã xác nhận đủ 18 tuổi.');
    } catch (err) {
      setAccountMsg(err.message);
    }
  }

  async function exportData() {
    try {
      const data = await api('/api/account/export', { token });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'virtual-cinema-account.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setAccountMsg(err.message);
    }
  }

  async function deleteAccount() {
    if (!window.confirm('Xoá vĩnh viễn tài khoản và các rạp bạn sở hữu?')) return;
    const password = window.prompt('Nhập mật khẩu để xác nhận:');
    if (!password) return;
    try {
      await api('/api/account', { method: 'DELETE', token, body: { password } });
      auth.logout();
    } catch (err) {
      setAccountMsg(err.message);
    }
  }

  function switchKind(kind) {
    setForm((previous) => ({
      ...previous,
      kind,
      src: kind === 'youtube' ? SAMPLE_YOUTUBE : SAMPLE_MP4,
    }));
  }

  return (
    <main className="theatres">
      <header className="theatres__bar">
        <div className="hud__brand">
          <span className="hud__title">Rạp Ảo</span>
          <span className="hud__room">Sảnh rạp</span>
        </div>
        <div className="hud__meta">
          <span className="chip">{user.name}</span>
          {user.role === 'admin' ? (
            <a className="icon-btn" href="/admin">
              Quản trị
            </a>
          ) : null}
          <button type="button" className="icon-btn icon-btn--danger" onClick={auth.logout}>
            Đăng xuất
          </button>
        </div>
      </header>

      <section className="theatres__hero">
        <p className="eyebrow">
          <span className="eyebrow__dot" />
          Sảnh rạp · {theatres.filter((theatre) => theatre.online > 0).length} rạp có người
        </p>
        <h1 className="display display--small">
          Chọn một rạp.
          <br />
          <em>Ngồi xuống.</em>
        </h1>
        <p className="lede">
          Vào rạp công khai bên dưới, hoặc nhập mã 6 ký tự để vào rạp riêng. Bạn có thể tự mở rạp
          của mình và điều khiển phim cho cả phòng.
        </p>

        <form
          className="quick-join"
          onSubmit={(event) => {
            event.preventDefault();
            joinTheatre(code);
          }}
        >
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="Mã rạp, ví dụ A1B2C3"
            maxLength={8}
            className="mono"
            aria-label="Mã rạp"
          />
          <button className="btn btn--primary" type="submit" disabled={joining}>
            {joining ? 'Đang vào…' : 'Vào bằng mã'}
          </button>
        </form>

        {notice ? <p className="notice">{notice}</p> : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <div className="theatres__layout">
        <section className="theatre-list">
          <header className="theatre-list__head">
            <h2>Rạp đang mở</h2>
            <span>{loading ? 'Đang tải…' : `${theatres.length} rạp`}</span>
          </header>

          {!loading && theatres.length === 0 ? (
            <p className="empty">Chưa có rạp nào. Tạo rạp đầu tiên ở bên phải.</p>
          ) : (
            <div className="theatre-grid">
              {theatres.map((theatre) => {
                const isOwner = theatre.owner.id === user.id;
                return (
                  <article className="theatre-card" key={theatre.id}>
                    <div className="theatre-card__screen">
                      <div className="theatre-card__bulbs" aria-hidden="true">
                        {Array.from({ length: 12 }).map((_, index) => (
                          <span key={index} />
                        ))}
                      </div>
                      <span className="theatre-card__code">{theatre.id}</span>
                    </div>

                    <header>
                      <div>
                        <h3>{theatre.name}</h3>
                        <p className="theatre-card__owner">{theatre.owner.name}</p>
                      </div>
                      <span className="theatre-card__badges">
                        {theatre.mature ? <span className="badge badge--mature">18+</span> : null}
                        <span
                          className={`badge ${theatre.visibility === 'private' ? 'badge--private' : ''} ${
                            theatre.status === 'closed' ? 'badge--closed' : ''
                          } ${theatre.status === 'pending_review' ? 'badge--pending' : ''} ${
                            theatre.status === 'rejected' || theatre.status === 'deleted'
                              ? 'badge--rejected'
                              : ''
                          }`}
                        >
                          {theatre.status === 'deleted'
                            ? 'Thùng rác'
                            : theatre.status === 'archived'
                              ? 'Lưu trữ'
                              : theatre.status === 'pending_review'
                                ? 'Chờ duyệt'
                                : theatre.status === 'rejected'
                                  ? 'Bị từ chối'
                                  : theatre.status === 'closed'
                                    ? 'Đã đóng'
                                    : theatre.visibility === 'private'
                                      ? 'Riêng tư'
                                      : 'Công khai'}
                        </span>
                      </span>
                    </header>

                    <p className="theatre-card__desc">
                      {theatre.status === 'pending_review'
                        ? `Đang chờ quản trị viên duyệt${theatre.moderation?.reason ? ` — ${theatre.moderation.reason}` : ''}.`
                        : theatre.description || 'Không có mô tả.'}
                    </p>

                    <footer>
                      <div className="theatre-card__meta">
                        <span className={`theatre-card__online ${theatre.online > 0 ? 'is-live' : ''}`}>
                          <span className="live-dot" />
                          {theatre.online} người
                        </span>
                        <span>{theatre.videoKind === 'youtube' ? 'YouTube' : 'MP4'}</span>
                      </div>

                      <div className="theatre-card__actions">
                        {isOwner && (theatre.status === 'deleted' || theatre.status === 'archived') ? (
                          <button
                            type="button"
                            className="card-btn"
                            onClick={() => restoreTheatre(theatre)}
                          >
                            Khôi phục
                          </button>
                        ) : null}
                        {isOwner && (theatre.status === 'open' || theatre.status === 'closed') ? (
                          <>
                            <button
                              type="button"
                              className="card-btn"
                              onClick={() =>
                                updateStatus(theatre, theatre.status === 'open' ? 'closed' : 'open')
                              }
                            >
                              {theatre.status === 'open' ? 'Đóng' : 'Mở'}
                            </button>
                            <button
                              type="button"
                              className="card-btn"
                              onClick={() => transferTheatre(theatre)}
                            >
                              Chuyển nhượng
                            </button>
                          </>
                        ) : null}
                        {isOwner && theatre.status === 'rejected' ? (
                          <button
                            type="button"
                            className="card-btn"
                            onClick={() => appealTheatre(theatre)}
                          >
                            Khiếu nại
                          </button>
                        ) : null}
                        {isOwner && !['deleted', 'archived'].includes(theatre.status) ? (
                          <button
                            type="button"
                            className="card-btn card-btn--danger"
                            onClick={() => removeTheatre(theatre)}
                          >
                            Xoá
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="card-btn card-btn--join"
                          disabled={theatre.status !== 'open' || joining}
                          onClick={() => joinTheatre(theatre.id)}
                        >
                          Vào rạp
                        </button>
                      </div>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="theatres__side">
        <aside className="create-card">
          <h2>Tạo rạp mới</h2>
          <p className="create-card__lede">
            Đặt tên, chọn nguồn phim và mức riêng tư. Hệ thống sẽ kiểm tra metadata phim trước khi
            mở rạp.
          </p>

          <form className="form" onSubmit={createTheatre}>
            <label className="field">
              <span>Tên rạp</span>
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Ví dụ: Phòng chiếu tối thứ Sáu"
                maxLength={60}
              />
            </label>

            <label className="field">
              <span>Mô tả ngắn</span>
              <input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="Không bắt buộc"
                maxLength={300}
              />
            </label>

            <div className="field">
              <span>Nguồn phim</span>
              <div className="segmented">
                <button
                  type="button"
                  className={form.kind === 'html5' ? 'is-active' : ''}
                  onClick={() => switchKind('html5')}
                >
                  Tệp MP4
                </button>
                <button
                  type="button"
                  className={form.kind === 'youtube' ? 'is-active' : ''}
                  onClick={() => switchKind('youtube')}
                >
                  YouTube
                </button>
              </div>
            </div>

            <label className="field">
              <span>{form.kind === 'youtube' ? 'Đường dẫn YouTube' : 'Đường dẫn video'}</span>
              <input
                value={form.src}
                onChange={(event) => setForm({ ...form, src: event.target.value })}
                spellCheck={false}
              />
            </label>

            <div className="field">
              <span>Chế độ</span>
              <div className="segmented">
                <button
                  type="button"
                  className={form.visibility === 'public' ? 'is-active' : ''}
                  onClick={() => setForm({ ...form, visibility: 'public' })}
                >
                  Công khai
                </button>
                <button
                  type="button"
                  className={form.visibility === 'private' ? 'is-active' : ''}
                  onClick={() => setForm({ ...form, visibility: 'private' })}
                >
                  Riêng tư
                </button>
              </div>
            </div>

            <label className="check">
              <input
                type="checkbox"
                checked={form.mature}
                onChange={(event) => setForm({ ...form, mature: event.target.checked })}
              />
              Nội dung 18+ (người xem phải xác nhận độ tuổi)
            </label>

            {formError.message ? (
              <div className="error" role="alert">
                <strong>{formError.message}</strong>
                {formError.reason ? <span> {formError.reason}</span> : null}
              </div>
            ) : null}

            <button className="btn btn--primary" type="submit" disabled={creating}>
              {creating ? 'Đang kiểm duyệt…' : 'Tạo và vào rạp'}
            </button>
          </form>

          <p className="hint">
            Kiểm duyệt tự động: blocklist local, và OpenAI nếu đã cấu hình `OPENAI_API_KEY`.
          </p>
        </aside>

        <aside className="account-card">
          <h2>Tài khoản</h2>
          <p className="account-card__email">{user.email}</p>
          <div className="account-card__row">
            {user.adultConfirmed ? (
              <span className="state state--live">Đã xác nhận 18+</span>
            ) : (
              <button type="button" className="card-btn" onClick={confirmAdultAccount}>
                Xác nhận đủ 18 tuổi
              </button>
            )}
          </div>

          <form className="form" onSubmit={changePassword}>
            <label className="field">
              <span>Mật khẩu hiện tại</span>
              <input
                type="password"
                value={currentPw}
                onChange={(event) => setCurrentPw(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label className="field">
              <span>Mật khẩu mới</span>
              <input
                type="password"
                value={newPw}
                onChange={(event) => setNewPw(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            <button className="btn btn--primary" type="submit">
              Đổi mật khẩu
            </button>
          </form>

          <div className="account-card__actions">
            <button type="button" className="card-btn" onClick={exportData}>
              Tải dữ liệu
            </button>
            <button type="button" className="card-btn card-btn--danger" onClick={deleteAccount}>
              Xoá tài khoản
            </button>
          </div>
          {accountMsg ? <p className="notice">{accountMsg}</p> : null}
        </aside>
        </div>
      </div>
    </main>
  );
}
