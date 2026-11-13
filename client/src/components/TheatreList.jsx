import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../net/api.js';
import { socket } from '../net/socket.js';
import { useInstallPrompt } from '../lib/install.js';
import Dialog from './Dialog.jsx';

const SAMPLE_MP4 =
  'https://cdn.jsdelivr.net/gh/mediaelement/mediaelement-files@master/big_buck_bunny.mp4';
const SAMPLE_YOUTUBE = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

const DIALOG_TITLES = {
  close: 'Đóng rạp',
  appeal: 'Khiếu nại rạp',
  transfer: 'Chuyển nhượng rạp',
  delete: 'Xoá rạp',
  deleteAccount: 'Xoá tài khoản',
  adult: 'Xác nhận 18+',
};
const DIALOG_ACTIONS = {
  close: 'Đóng rạp',
  appeal: 'Gửi khiếu nại',
  transfer: 'Chuyển nhượng',
  delete: 'Xoá rạp',
  deleteAccount: 'Xoá tài khoản',
  adult: 'Xác nhận',
};
const DIALOG_NOTES = {
  close: 'Rạp sẽ đóng với mọi người. Bạn có thể mở lại sau.',
  appeal: 'Quản trị viên sẽ xem lại rạp này.',
  transfer: 'Bạn sẽ không còn là chủ rạp này.',
  delete: 'Rạp vào thùng rác 30 ngày và có thể khôi phục.',
  deleteAccount: 'Xoá vĩnh viễn tài khoản và các rạp bạn sở hữu. Không hoàn tác được.',
  adult: 'Rạp này gắn nhãn 18+. Bạn xác nhận mình đủ 18 tuổi?',
};
const DIALOG_DANGER = new Set(['close', 'delete', 'deleteAccount']);
const DIALOG_NEEDS_TEXT = new Set(['appeal', 'transfer', 'deleteAccount']);

export default function TheatreList({ auth, onEnter, initialCode = '' }) {
  const { token, user } = auth;
  const { canInstall, install } = useInstallPrompt();
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
  const [dialog, setDialog] = useState(null);
  const [dialogValue, setDialogValue] = useState('');
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [listError, setListError] = useState('');
  const autoJoinRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api('/api/theatres', { token });
      setTheatres(data.theatres);
      setListError('');
    } catch (err) {
      setListError(err.message);
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
    if (!initialCode || autoJoinRef.current) return undefined;
    autoJoinRef.current = true;
    const run = () => joinTheatre(initialCode);
    if (socket.connected) run();
    else socket.once('connect', run);
    return () => socket.off('connect', run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

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

  function confirmAdultAndJoin(id) {
    openDialog('adult', { code: id });
  }

  function openDialog(type, data = {}) {
    setDialog({ type, ...data });
    setDialogValue('');
    setDialogError('');
  }

  function closeDialog() {
    if (dialogBusy) return;
    setDialog(null);
    setDialogValue('');
  }

  async function submitDialog() {
    if (!dialog || dialogBusy) return;
    setDialogBusy(true);
    setDialogError('');
    try {
      if (dialog.type === 'close') {
        await api(`/api/theatres/${dialog.theatre.id}`, {
          method: 'PATCH',
          token,
          body: { status: 'closed' },
        });
        setNotice('Đã đóng rạp.');
      } else if (dialog.type === 'appeal') {
        await api(`/api/theatres/${dialog.theatre.id}/appeal`, {
          method: 'POST',
          token,
          body: { reason: dialogValue.trim() },
        });
        setNotice('Đã gửi khiếu nại. Rạp sẽ được quản trị viên xem lại.');
      } else if (dialog.type === 'transfer') {
        await api(`/api/theatres/${dialog.theatre.id}/transfer`, {
          method: 'POST',
          token,
          body: { email: dialogValue.trim() },
        });
        setNotice('Đã chuyển nhượng rạp.');
      } else if (dialog.type === 'delete') {
        await api(`/api/theatres/${dialog.theatre.id}`, { method: 'DELETE', token });
        setNotice('Đã chuyển rạp vào thùng rác (khôi phục được trong 30 ngày).');
      } else if (dialog.type === 'deleteAccount') {
        await api('/api/account', { method: 'DELETE', token, body: { password: dialogValue } });
        auth.logout();
        return;
      } else if (dialog.type === 'adult') {
        await api('/api/account/adult', { method: 'POST', token, body: { confirmed: true } });
        const code = dialog.code;
        setDialog(null);
        setDialogValue('');
        setDialogBusy(false);
        joinTheatre(code);
        return;
      }
      setDialog(null);
      setDialogValue('');
      refresh();
    } catch (err) {
      setDialogError(err.message);
    } finally {
      setDialogBusy(false);
    }
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
    if (status === 'closed') {
      openDialog('close', { theatre });
      return;
    }
    try {
      await api(`/api/theatres/${theatre.id}`, { method: 'PATCH', token, body: { status } });
      setNotice('Đã mở lại rạp.');
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  function appealTheatre(theatre) {
    openDialog('appeal', { theatre });
  }

  function removeTheatre(theatre) {
    openDialog('delete', { theatre });
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

  function transferTheatre(theatre) {
    openDialog('transfer', { theatre });
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

  function deleteAccount() {
    openDialog('deleteAccount');
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
          {canInstall ? (
            <button type="button" className="icon-btn" onClick={install}>
              Cài ứng dụng
            </button>
          ) : null}
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
          của mình và điều khiển phim cho cả rạp.
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

        <a className="link-cta" href="#create">
          Hoặc tạo rạp của bạn
        </a>

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

          {loading && theatres.length === 0 ? (
            <div className="theatre-grid" aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <div className="theatre-card theatre-card--skeleton" key={index}>
                  <div className="theatre-card__screen" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line skeleton-line--short" />
                </div>
              ))}
            </div>
          ) : listError && theatres.length === 0 ? (
            <div className="empty empty--error">
              <p>Không tải được danh sách rạp. {listError}</p>
              <button
                type="button"
                className="btn btn--inline"
                onClick={() => {
                  setLoading(true);
                  setListError('');
                  refresh();
                }}
              >
                Thử lại
              </button>
            </div>
          ) : theatres.length === 0 ? (
            <p className="empty">Chưa có rạp nào. Tạo rạp đầu tiên của bạn.</p>
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
        <aside className="create-card" id="create">
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

      <Dialog
        open={!!dialog}
        title={dialog ? DIALOG_TITLES[dialog.type] : ''}
        onClose={closeDialog}
      >
        {dialog?.type === 'appeal' ? (
          <label className="field">
            <span>Lý do khiếu nại</span>
            <textarea
              value={dialogValue}
              onChange={(event) => setDialogValue(event.target.value)}
              maxLength={500}
              rows={4}
            />
          </label>
        ) : null}
        {dialog?.type === 'transfer' ? (
          <label className="field">
            <span>Email người nhận</span>
            <input
              type="email"
              value={dialogValue}
              onChange={(event) => setDialogValue(event.target.value)}
              placeholder="ban@example.com"
              spellCheck={false}
            />
          </label>
        ) : null}
        {dialog?.type === 'deleteAccount' ? (
          <label className="field">
            <span>Mật khẩu</span>
            <input
              type="password"
              value={dialogValue}
              onChange={(event) => setDialogValue(event.target.value)}
              autoComplete="current-password"
            />
          </label>
        ) : null}

        <p className="dialog__note">{dialog ? DIALOG_NOTES[dialog.type] : ''}</p>

        {dialogError ? (
          <p className="error" role="alert">
            {dialogError}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button type="button" className="btn" onClick={closeDialog} disabled={dialogBusy}>
            Huỷ
          </button>
          <button
            type="button"
            className={`btn ${
              dialog && DIALOG_DANGER.has(dialog.type) ? 'btn--danger' : 'btn--primary'
            }`}
            onClick={submitDialog}
            disabled={
              dialogBusy ||
              (dialog && DIALOG_NEEDS_TEXT.has(dialog.type) && !dialogValue.trim())
            }
          >
            {dialogBusy ? 'Đang xử lý…' : dialog ? DIALOG_ACTIONS[dialog.type] : ''}
          </button>
        </div>
      </Dialog>
    </main>
  );
}
