import { useCallback, useEffect, useState } from 'react';
import { api } from '../net/api.js';
import { socket } from '../net/socket.js';

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}g ${minutes}p`;
  if (minutes > 0) return `${minutes} phút`;
  return `${total}s`;
}

function ago(timestamp) {
  if (!timestamp) return '—';
  return formatDuration((Date.now() - timestamp) / 1000);
}

function dayLabel(date) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

function Kpi({ label, value, note, accent }) {
  return (
    <article className={`kpi ${accent ? 'kpi--accent' : ''}`}>
      <span className="kpi__label">{label}</span>
      <strong className="kpi__value">{value}</strong>
      <span className="kpi__note">{note}</span>
    </article>
  );
}

function ActivityBars({ days }) {
  const max = Math.max(1, ...days.map((day) => day.sessions));
  return (
    <div className="bars">
      {days.map((day) => (
        <div className="bar" key={day.date}>
          <span className="bar__value">{day.sessions}</span>
          <div className="bar__track">
            <span
              className="bar__fill"
              style={{ height: `${Math.max(3, Math.round((day.sessions / max) * 100))}%` }}
            />
          </div>
          <span className="bar__label">{dayLabel(day.date)}</span>
          <span className="bar__visitors">{day.visitors} khách</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminView({ auth }) {
  const { token, logout } = auth;
  const [overview, setOverview] = useState(null);
  const [live, setLive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await api('/api/admin/overview', { token });
      setOverview(data);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 20000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const onStats = (payload) => setLive(payload);
    socket.on('admin:stats', onStats);
    socket.emit('admin:subscribe', () => {});
    return () => {
      socket.off('admin:stats', onStats);
      socket.emit('admin:unsubscribe');
    };
  }, []);

  async function patchUser(user, patch) {
    setBusy(`user:${user.id}`);
    setError('');
    try {
      await api(`/api/admin/users/${user.id}`, { method: 'PATCH', token, body: patch });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function theatreAction(theatre, action) {
    setBusy(`theatre:${theatre.id}`);
    setError('');
    try {
      if (action === 'delete') {
        if (!window.confirm(`Xoá rạp "${theatre.name}"?`)) return;
        await api(`/api/admin/theatres/${theatre.id}`, { method: 'DELETE', token });
      } else {
        await api(`/api/admin/theatres/${theatre.id}`, {
          method: 'PATCH',
          token,
          body: { status: action },
        });
      }
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function reviewTheatre(theatre, approve) {
    setBusy(`theatre:${theatre.id}`);
    setError('');
    try {
      await api(`/api/admin/theatres/${theatre.id}/review`, {
        method: 'POST',
        token,
        body: { approve },
      });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function muteUser(theatreId, userId, minutes) {
    setBusy(`live:${theatreId}:${userId}`);
    setError('');
    try {
      await api(`/api/theatres/${theatreId}/mute`, {
        method: 'POST',
        token,
        body: { userId, minutes },
      });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function kickUser(theatreId, userId) {
    setBusy(`live:${theatreId}:${userId}`);
    setError('');
    try {
      await api(`/api/theatres/${theatreId}/kick`, {
        method: 'POST',
        token,
        body: { userId },
      });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function banFromTheatre(theatreId, userId) {
    if (!window.confirm('Cấm người này vào rạp?')) return;
    setBusy(`live:${theatreId}:${userId}`);
    setError('');
    try {
      await api(`/api/theatres/${theatreId}/ban`, {
        method: 'POST',
        token,
        body: { userId, banned: true },
      });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function resolveReport(report, status) {
    setBusy(`report:${report.id}`);
    setError('');
    try {
      await api(`/api/admin/reports/${report.id}`, {
        method: 'PATCH',
        token,
        body: { status },
      });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const stats = live || overview?.stats;
  const users = overview?.users || [];
  const theatres = overview?.theatres || [];
  const moderation = overview?.moderation || [];
  const reports = overview?.reports || [];
  const audit = overview?.audit || [];

  return (
    <main className="admin">
      <header className="admin__bar">
        <div className="admin__brand">
          <span className="admin__eyebrow">Virtual Cinema · Quản trị</span>
          <h1>Bảng điều khiển</h1>
        </div>
        <div className="admin__actions">
          <span className="live-pill">
            <span className="live-dot" />
            Trực tiếp
          </span>
          <button type="button" className="icon-btn" onClick={logout}>
            Đăng xuất
          </button>
        </div>
      </header>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !stats ? (
        <p className="admin__loading">Đang tải số liệu…</p>
      ) : (
        <>
          <section className="kpis">
            <Kpi label="Đang online" value={stats.connected} note="kết nối đồng thời" accent />
            <Kpi label="Người dùng" value={stats.uniqueUsers} note={`${stats.users} tài khoản`} />
            <Kpi label="Trong rạp" value={stats.online} note={`${stats.seated} ghế đã ngồi`} />
            <Kpi label="Đang bật mic" value={stats.speaking} note={`${stats.voice} đang nghe`} />
            <Kpi label="Rạp" value={stats.theatres} note={`${stats.rooms.length} đang mở`} />
          </section>

          <div className="admin__grid">
            <section className="panel">
              <header className="panel__head">
                <h2>Phiên theo ngày</h2>
                <span>7 ngày gần nhất</span>
              </header>
              <ActivityBars days={stats.recent} />
            </section>

            <section className="panel">
              <header className="panel__head">
                <h2>Tóm tắt</h2>
                <span>Kiểm duyệt: {stats.moderationProvider}</span>
              </header>
              <dl className="summary">
                <div>
                  <dt>Tổng phiên</dt>
                  <dd>{stats.totalSessions}</dd>
                </div>
                <div>
                  <dt>Người online</dt>
                  <dd>{stats.uniqueUsers}</dd>
                </div>
                <div>
                  <dt>Ở sảnh</dt>
                  <dd>{stats.lobby}</dd>
                </div>
                <div>
                  <dt>Thời gian chạy</dt>
                  <dd>{formatDuration(stats.uptime)}</dd>
                </div>
              </dl>
            </section>
          </div>

          <section className="panel">
            <header className="panel__head">
              <h2>Rạp</h2>
              <span>{theatres.length} rạp</span>
            </header>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Mã</th>
                    <th>Tên</th>
                    <th>Chủ rạp</th>
                    <th>Chế độ</th>
                    <th>Trạng thái</th>
                    <th>Online</th>
                    <th>Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {theatres.map((theatre) => (
                    <tr key={theatre.id}>
                      <td>
                        <code className="admin__code">{theatre.id}</code>
                      </td>
                      <td>{theatre.name}</td>
                      <td>{theatre.owner.name}</td>
                      <td>{theatre.visibility === 'private' ? 'Riêng tư' : 'Công khai'}</td>
                      <td>
                        {theatre.status === 'pending_review' ? (
                          <span className="state state--host">Chờ duyệt</span>
                        ) : theatre.status === 'rejected' ? (
                          <span className="state state--muted">Từ chối</span>
                        ) : (
                          <span className={`state ${theatre.status === 'open' ? 'state--live' : ''}`}>
                            {theatre.status === 'open' ? 'Mở' : 'Đóng'}
                          </span>
                        )}
                      </td>
                      <td>{theatre.online}</td>
                      <td>
                        {theatre.status === 'pending_review' ? (
                          <>
                            <button
                              type="button"
                              className="card-btn card-btn--join"
                              disabled={busy === `theatre:${theatre.id}`}
                              onClick={() => reviewTheatre(theatre, true)}
                            >
                              Duyệt
                            </button>
                            <button
                              type="button"
                              className="card-btn card-btn--danger"
                              disabled={busy === `theatre:${theatre.id}`}
                              onClick={() => reviewTheatre(theatre, false)}
                            >
                              Từ chối
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="card-btn"
                              disabled={busy === `theatre:${theatre.id}`}
                              onClick={() =>
                                theatreAction(theatre, theatre.status === 'open' ? 'closed' : 'open')
                              }
                            >
                              {theatre.status === 'open' ? 'Đóng' : 'Mở'}
                            </button>
                            <button
                              type="button"
                              className="card-btn card-btn--danger"
                              disabled={busy === `theatre:${theatre.id}`}
                              onClick={() => theatreAction(theatre, 'delete')}
                            >
                              Xoá
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <header className="panel__head">
              <h2>Đang trong rạp</h2>
              <span>{stats.rooms.length} rạp có người</span>
            </header>
            {stats.rooms.length === 0 ? (
              <p className="empty">Không có ai trong rạp.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Rạp</th>
                      <th>Người</th>
                      <th>Ghế</th>
                      <th>Voice</th>
                      <th>Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.rooms.flatMap((room) =>
                      room.users.map((person) => (
                        <tr key={`${room.id}:${person.id}`}>
                          <td>
                            <code className="admin__code">{room.id}</code> {room.name}
                          </td>
                          <td>{person.name}</td>
                          <td>{person.seatId || '—'}</td>
                          <td>
                            {person.speaking ? (
                              <span className="state state--live">Đang nói</span>
                            ) : person.voice ? (
                              <span className="state">Đang nghe</span>
                            ) : (
                              <span className="state state--muted">Tắt</span>
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="card-btn"
                              disabled={busy === `live:${room.id}:${person.accountId}`}
                              onClick={() => muteUser(room.id, person.accountId, 10)}
                            >
                              Mute 10p
                            </button>
                            <button
                              type="button"
                              className="card-btn"
                              disabled={busy === `live:${room.id}:${person.accountId}`}
                              onClick={() => kickUser(room.id, person.accountId)}
                            >
                              Kick
                            </button>
                            <button
                              type="button"
                              className="card-btn card-btn--danger"
                              disabled={busy === `live:${room.id}:${person.accountId}`}
                              onClick={() => banFromTheatre(room.id, person.accountId)}
                            >
                              Ban
                            </button>
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <header className="panel__head">
              <h2>Người dùng</h2>
              <span>{users.length} tài khoản</span>
            </header>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tên</th>
                    <th>Email</th>
                    <th>Vai trò</th>
                    <th>Strikes</th>
                    <th>Trạng thái</th>
                    <th>Online</th>
                    <th>Đăng ký</th>
                    <th>Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((person) => (
                    <tr key={person.id}>
                      <td>{person.name}</td>
                      <td>{person.email}</td>
                      <td>
                        <span className={`state ${person.role === 'admin' ? 'state--host' : ''}`}>
                          {person.role === 'admin' ? 'Admin' : 'Người dùng'}
                        </span>
                      </td>
                      <td>{person.strikes || 0}</td>
                      <td>
                        <span className={`state ${person.banned ? 'state--muted' : 'state--live'}`}>
                          {person.banned ? 'Đã khoá' : 'Bình thường'}
                        </span>
                      </td>
                      <td>{person.online ? 'Online' : '—'}</td>
                      <td>{ago(person.createdAt)}</td>
                      <td>
                        {person.role !== 'admin' ? (
                          <button
                            type="button"
                            className="card-btn"
                            disabled={busy === `user:${person.id}`}
                            onClick={() => patchUser(person, { role: 'admin' })}
                          >
                            Nâng admin
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="card-btn"
                            disabled={busy === `user:${person.id}`}
                            onClick={() => patchUser(person, { role: 'user' })}
                          >
                            Hạ quyền
                          </button>
                        )}
                        <button
                          type="button"
                          className="card-btn card-btn--danger"
                          disabled={busy === `user:${person.id}`}
                          onClick={() => patchUser(person, { banned: !person.banned })}
                        >
                          {person.banned ? 'Bỏ khoá' : 'Khoá'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <header className="panel__head">
              <h2>Kiểm duyệt phim</h2>
              <span>{moderation.length} lần kiểm tra gần nhất</span>
            </header>
            {moderation.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Lúc</th>
                      <th>Người</th>
                      <th>Tên phim</th>
                      <th>Kết quả</th>
                      <th>Nguồn</th>
                      <th>Lý do</th>
                    </tr>
                  </thead>
                  <tbody>
                    {moderation.map((entry) => (
                      <tr key={entry.id}>
                        <td>{ago(entry.at)}</td>
                        <td>{entry.email}</td>
                        <td>{entry.name}</td>
                        <td>
                          <span className={`state ${entry.verdict === 'blocked' ? 'state--muted' : 'state--live'}`}>
                            {entry.verdict === 'blocked' ? 'Chặn' : 'Cho phép'}
                          </span>
                        </td>
                        <td>{entry.provider}</td>
                        <td>{entry.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">Chưa có phim nào được kiểm tra.</p>
            )}
          </section>

          <section className="panel">
            <header className="panel__head">
              <h2>Báo cáo</h2>
              <span>{reports.length} báo cáo</span>
            </header>
            {reports.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Lúc</th>
                      <th>Rạp</th>
                      <th>Người gửi</th>
                      <th>Lý do</th>
                      <th>Trạng thái</th>
                      <th>Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((report) => (
                      <tr key={report.id}>
                        <td>{ago(report.at)}</td>
                        <td>
                          <code className="admin__code">{report.theatreId}</code> {report.theatreName}
                        </td>
                        <td>{report.reporterEmail}</td>
                        <td>{report.reason}</td>
                        <td>
                          <span
                            className={`state ${
                              report.status === 'open' ? 'state--host' : 'state--muted'
                            }`}
                          >
                            {report.status === 'open'
                              ? 'Mới'
                              : report.status === 'resolved'
                                ? 'Đã xử lý'
                                : 'Bỏ qua'}
                          </span>
                        </td>
                        <td>
                          {report.status === 'open' ? (
                            <>
                              <button
                                type="button"
                                className="card-btn"
                                disabled={busy === `report:${report.id}`}
                                onClick={() => resolveReport(report, 'resolved')}
                              >
                                Xử lý
                              </button>
                              <button
                                type="button"
                                className="card-btn"
                                disabled={busy === `report:${report.id}`}
                                onClick={() => resolveReport(report, 'dismissed')}
                              >
                                Bỏ qua
                              </button>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">Chưa có báo cáo.</p>
            )}
          </section>

          <section className="panel">
            <header className="panel__head">
              <h2>Audit log</h2>
              <span>{audit.length} sự kiện gần nhất</span>
            </header>
            {audit.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Lúc</th>
                      <th>Người thực hiện</th>
                      <th>Hành động</th>
                      <th>Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((entry) => (
                      <tr key={entry.id}>
                        <td>{ago(entry.at)}</td>
                        <td>{entry.actorEmail}</td>
                        <td>
                          <span className="state">{entry.action}</span>
                        </td>
                        <td className="admin__visitor">
                          {Object.entries(entry)
                            .filter(
                              ([key]) =>
                                !['id', 'at', 'actorId', 'actorEmail', 'action'].includes(key),
                            )
                            .map(([key, value]) => `${key}=${String(value).slice(0, 60)}`)
                            .join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">Chưa có hoạt động.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
