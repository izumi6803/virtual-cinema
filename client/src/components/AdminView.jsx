import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../net/api.js';
import { socket } from '../net/socket.js';
import Dialog from './Dialog.jsx';
import { Icon } from './Icons.jsx';

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}g ${minutes}p`;
  if (minutes > 0) return `${minutes} phút`;
  return `${total}s`;
}

function ago(timestamp, suffix = true) {
  if (!timestamp) return '—';
  const value = formatDuration((Date.now() - timestamp) / 1000);
  return suffix && value !== '—' ? `${value} trước` : value;
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

function Ring() {
  return (
    <svg className="a-ring" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="8.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="16" r="2.6" fill="currentColor" />
    </svg>
  );
}

function ReasonSelect({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="a-select" ref={ref}>
      <button
        type="button"
        className="a-select__trigger"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className={value ? '' : 'is-placeholder'}>
          {value || 'Chọn lý do xử lý…'}
        </span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <div className="a-select__menu" role="listbox" aria-label="Lý do xử lý">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={value === option}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const NAV = [
  { id: 'overview', label: 'Tổng quan', icon: 'dashboard' },
  { id: 'queue', label: 'Hàng đợi', icon: 'inbox' },
  { id: 'theatres', label: 'Rạp', icon: 'clapperboard' },
  { id: 'users', label: 'Người dùng', icon: 'people' },
  { id: 'live', label: 'Trực tiếp', icon: 'radio' },
  { id: 'history', label: 'Lịch sử', icon: 'history' },
];

const TITLES = {
  overview: 'Tổng quan',
  queue: 'Hàng đợi',
  theatres: 'Rạp',
  users: 'Người dùng',
  live: 'Trực tiếp',
  history: 'Lịch sử',
};

const SEARCH_PLACEHOLDERS = {
  queue: 'Tìm rạp, mã, lý do…',
  theatres: 'Tìm mã, tên, chủ rạp…',
  users: 'Tìm tên, email…',
  live: 'Tìm rạp, người…',
  history: 'Tìm người, hành động…',
};

const REPORT_REASONS = ['Bản quyền', 'Nội dung không phù hợp', 'Spam / quảng cáo', 'Khác'];
const THEATRE_REASONS = [
  'Metadata không hợp lệ',
  'Nội dung không phù hợp',
  'Vi phạm bản quyền',
  'Khác',
];

export default function AdminView({ auth }) {
  const { token, logout, user } = auth;
  const [overview, setOverview] = useState(null);
  const [live, setLive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [view, setView] = useState('queue');
  const [query, setQuery] = useState('');
  const [queueFilter, setQueueFilter] = useState('all');
  const [selectedKey, setSelectedKey] = useState(null);
  const [reason, setReason] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [theatreFilter, setTheatreFilter] = useState('all');
  const [historyTab, setHistoryTab] = useState('audit');

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

  useEffect(() => {
    if (!mobileNav && !mobileDetail) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (mobileNav) setMobileNav(false);
      else setMobileDetail(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileNav, mobileDetail]);

  const stats = live || overview?.stats;
  const users = overview?.users || [];
  const theatres = overview?.theatres || [];
  const moderation = overview?.moderation || [];
  const reports = overview?.reports || [];
  const audit = overview?.audit || [];
  const rooms = stats?.rooms || [];

  const queueItems = useMemo(() => {
    const items = [];
    for (const report of reports) {
      if (report.status !== 'open') continue;
      items.push({
        key: `report:${report.id}`,
        kind: 'report',
        id: report.id,
        typeLabel: 'Báo cáo',
        typeIcon: 'flag',
        target: report.theatreName,
        code: report.theatreId,
        reason: report.reason,
        at: report.at,
        status: 'Mới',
        reporter: report.reporterEmail,
        report,
      });
    }
    for (const theatre of theatres) {
      if (theatre.status !== 'pending_review') continue;
      items.push({
        key: `theatre:${theatre.id}`,
        kind: 'pending',
        id: theatre.id,
        typeLabel: 'Rạp chờ duyệt',
        typeIcon: 'clapperboard',
        target: theatre.name,
        code: theatre.id,
        reason: theatre.description || 'Chưa có mô tả.',
        at: theatre.createdAt,
        status: 'Chờ duyệt',
        owner: theatre.owner?.name || '—',
        ownerEmail: theatre.ownerEmail,
        theatre,
      });
    }
    return items.sort(
      (first, second) => (first.at || Number.MAX_SAFE_INTEGER) - (second.at || Number.MAX_SAFE_INTEGER),
    );
  }, [reports, theatres]);

  const normalized = query.trim().toLowerCase();
  const hit = (...values) =>
    !normalized || values.some((value) => String(value || '').toLowerCase().includes(normalized));

  const filteredQueue = queueItems.filter(
    (item) =>
      (queueFilter === 'all' || item.kind === queueFilter) &&
      hit(item.target, item.code, item.reason, item.reporter, item.owner),
  );
  const selectedItem =
    filteredQueue.find((item) => item.key === selectedKey) || filteredQueue[0] || null;

  useEffect(() => {
    if (!filteredQueue.length) {
      if (selectedKey) setSelectedKey(null);
      return;
    }
    if (!filteredQueue.some((item) => item.key === selectedKey)) {
      setSelectedKey(filteredQueue[0].key);
    }
  }, [filteredQueue, selectedKey]);

  useEffect(() => {
    setReason('');
  }, [selectedItem?.key]);

  const filteredTheatres = theatres.filter(
    (theatre) =>
      (theatreFilter === 'all' || theatre.status === theatreFilter) &&
      hit(theatre.id, theatre.name, theatre.owner?.name, theatre.ownerEmail),
  );
  const filteredUsers = users.filter((person) => hit(person.name, person.email));
  const filteredAudit = audit.filter((entry) =>
    hit(entry.actorEmail, entry.action, JSON.stringify(entry)),
  );
  const filteredModeration = moderation.filter((entry) =>
    hit(entry.email, entry.name, entry.verdict, entry.reason),
  );
  const filteredReports = reports.filter((report) =>
    hit(report.theatreId, report.theatreName, report.reporterEmail, report.reason, report.status),
  );

  function changeView(nextView) {
    setView(nextView);
    setQuery('');
    setMobileNav(false);
    setMobileDetail(false);
  }

  function openTheatre(code) {
    setView('theatres');
    setQuery(code);
    setTheatreFilter('all');
    setMobileDetail(false);
  }

  function theatreStatus(theatre, action) {
    if (action === 'delete') {
      setConfirm({
        title: 'Xoá rạp',
        message: `Xoá vĩnh viễn rạp "${theatre.name}"? Hành động này không hoàn tác.`,
        label: 'Xoá rạp',
        danger: true,
        onConfirm: () => removeTheatre(theatre),
      });
      return;
    }
    setBusy(`theatre:${theatre.id}`);
    setError('');
    api(`/api/admin/theatres/${theatre.id}`, { method: 'PATCH', token, body: { status: action } })
      .then(refresh)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(''));
  }

  async function removeTheatre(theatre) {
    setBusy(`theatre:${theatre.id}`);
    setError('');
    try {
      await api(`/api/admin/theatres/${theatre.id}`, { method: 'DELETE', token });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  function openPendingQueue(theatre) {
    setQuery('');
    setQueueFilter('all');
    setSelectedKey(`theatre:${theatre.id}`);
    setView('queue');
    setMobileNav(false);
    setMobileDetail(true);
  }

  async function patchUser(person, patch) {
    setBusy(`user:${person.id}`);
    setError('');
    try {
      await api(`/api/admin/users/${person.id}`, { method: 'PATCH', token, body: patch });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  function askBanUser(person) {
    if (person.banned) {
      patchUser(person, { banned: false });
      return;
    }
    setConfirm({
      title: 'Khoá tài khoản',
      message: `Khoá tài khoản ${person.email}? Người này sẽ không đăng nhập được.`,
      label: 'Khoá tài khoản',
      danger: true,
      onConfirm: () => patchUser(person, { banned: true }),
    });
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

  function banFromTheatre(theatreId, userId) {
    setConfirm({
      title: 'Cấm khỏi rạp',
      message: 'Người này sẽ bị đưa ra khỏi rạp và không thể vào lại rạp này.',
      label: 'Cấm khỏi rạp',
      danger: true,
      onConfirm: async () => {
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
      },
    });
  }

  async function runQueueAction(action) {
    if (!selectedItem || !reason) return;
    setBusy(selectedItem.key);
    setError('');
    try {
      if (selectedItem.kind === 'report') {
        await api(`/api/admin/reports/${selectedItem.id}`, {
          method: 'PATCH',
          token,
          body: { status: action === 'resolve' ? 'resolved' : 'dismissed', reason },
        });
      } else {
        await api(`/api/admin/theatres/${selectedItem.id}/review`, {
          method: 'POST',
          token,
          body: { approve: action === 'approve', reason },
        });
      }
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const queueCount = queueItems.length;
  const oldest = queueItems[0]?.at;
  const reasonOptions = selectedItem?.kind === 'pending' ? THEATRE_REASONS : REPORT_REASONS;
  const queueBusy = busy === selectedItem?.key;
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;

  function renderOverview() {
    return (
      <>
        <section className="panel a-attention">
          <header className="panel__head">
            <h2>Cần xử lý</h2>
            <span>{queueCount} việc</span>
          </header>
          <div className="a-attention__body">
            <div>
              <strong>{queueCount}</strong>
              <p>
                {queueCount
                  ? `Việc cũ nhất đang chờ ${ago(oldest)}.`
                  : 'Không còn việc nào đang chờ xử lý.'}
              </p>
            </div>
            <button type="button" className="btn btn--primary" onClick={() => changeView('queue')}>
              Mở hàng đợi
            </button>
          </div>
        </section>

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
      </>
    );
  }

  function queueState() {
    if (loading && !overview) {
      return (
        <>
          {[0, 1, 2, 3, 4].map((index) => (
            <div className="a-skeleton" key={index}>
              <span className="a-skeleton__line is-short" />
              <span className="a-skeleton__line" />
              <span className="a-skeleton__line is-tiny" />
            </div>
          ))}
        </>
      );
    }
    if (error && !overview) {
      return (
        <div className="a-state" role="alert">
          <p className="a-state__title">Không tải được hàng đợi</p>
          <p>{error}</p>
          <button type="button" className="a-btn a-btn--outline" onClick={refresh}>
            <Icon name="refresh" size={14} />
            Thử lại
          </button>
        </div>
      );
    }
    if (!filteredQueue.length) {
      return (
        <div className="a-state">
          <p>{normalized ? 'Không có việc nào khớp tìm kiếm.' : 'Không còn việc nào cần xử lý.'}</p>
          {normalized ? (
            <button type="button" className="a-link" onClick={() => setQuery('')}>
              Xoá tìm kiếm
            </button>
          ) : (
            <button type="button" className="a-link" onClick={() => changeView('history')}>
              Xem lịch sử
            </button>
          )}
        </div>
      );
    }
    return filteredQueue.map((item) => (
      <button
        key={item.key}
        type="button"
        className="a-qitem"
        aria-current={selectedItem?.key === item.key}
        onClick={() => {
          setSelectedKey(item.key);
          if (narrow) setMobileDetail(true);
        }}
      >
        <span className="a-qitem__top">
          <span className="a-type">
            <Icon name={item.typeIcon} size={13} />
            {item.typeLabel}
          </span>
          <span className={`a-badge ${item.kind === 'pending' ? 'a-badge--pending' : 'a-badge--new'}`}>
            {item.status}
          </span>
          <span className="a-qitem__age">{ago(item.at)}</span>
        </span>
        <span className="a-qitem__target">
          {item.target}
          <span className="a-code">{item.code}</span>
        </span>
        <span className="a-qitem__bottom">
          {item.kind === 'report' ? (
            <>
              <Icon name="people" size={12} />1 báo cáo · {item.reporter}
            </>
          ) : (
            <>Tạo bởi {item.owner}</>
          )}
          <span className="a-dot">·</span>
          <span className="a-qitem__reason">{item.reason}</span>
        </span>
      </button>
    ));
  }

  function renderDetail(item) {
    if (!item) {
      return (
        <div className="a-detail-empty">
          <Icon name="inbox" size={22} />
          <p>Chọn một mục để xem chi tiết.</p>
        </div>
      );
    }
    const isPending = item.kind === 'pending';
    return (
      <div className="a-detail">
        <button
          type="button"
          className="a-back"
          onClick={() => setMobileDetail(false)}
        >
          <Icon name="arrowLeft" size={14} />
          Danh sách
        </button>

        <div className="a-detail__top">
          <span className="a-type">
            <Icon name={item.typeIcon} size={13} />
            {item.typeLabel}
          </span>
          <span className={`a-badge ${isPending ? 'a-badge--pending' : 'a-badge--new'}`}>
            {item.status}
          </span>
          <span className="a-detail__age">{ago(item.at)}</span>
        </div>

        <h2 className="a-detail__title">{item.target}</h2>
        <p className="a-detail__meta">
          <span className="a-code">{item.code}</span>
          <span>·</span>
          <span>
            {isPending ? 'Người tạo' : 'Người báo cáo'}:{' '}
            {isPending ? item.owner : item.reporter}
          </span>
          {isPending ? null : (
            <>
              <span>·</span>
              <span>1 báo cáo</span>
            </>
          )}
        </p>

        <section className="a-detail__sec">
          <h3>{isPending ? 'Metadata rạp' : 'Báo cáo của người xem'}</h3>
          <blockquote className="a-evidence">{item.reason}</blockquote>
          {isPending ? (
            <p className="a-detail__note">
              Nguồn: {item.theatre?.video?.kind === 'youtube' ? 'YouTube' : 'MP4'} · Trạng
              thái: chờ quyết định.
            </p>
          ) : (
            <div className="a-reporter">
              <span className="a-avatar">{String(item.reporter || '?').slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{item.reporter}</strong>
                <span>{ago(item.at)}</span>
              </div>
            </div>
          )}
        </section>

        <section className="a-detail__sec">
          <h3>
            Lý do xử lý <span className="a-req">*</span>
          </h3>
          <ReasonSelect value={reason} options={reasonOptions} onChange={setReason} />
          <p className="a-hint">Bắt buộc trước khi xử lý; lý do được ghi vào audit.</p>
        </section>

        <section className="a-detail__sec">
          <h3>Hoạt động</h3>
          <ul className="a-hist">
            <li>
              {isPending ? 'Tạo rạp' : 'Người xem báo cáo'} · {ago(item.at)}
            </li>
            <li>{isPending ? 'Chờ duyệt metadata' : 'Trạng thái: Mới'}</li>
            {isPending && item.theatre?.moderation?.reason ? (
              <li>Kiểm duyệt: {item.theatre.moderation.reason}</li>
            ) : null}
          </ul>
        </section>

        <div className="a-actions">
          {isPending ? (
            <>
              <button
                type="button"
                className="a-btn a-btn--primary"
                disabled={!reason || queueBusy}
                onClick={() => runQueueAction('approve')}
              >
                Duyệt rạp
              </button>
              <button
                type="button"
                className="a-btn a-btn--danger"
                disabled={!reason || queueBusy}
                onClick={() => runQueueAction('reject')}
              >
                Từ chối
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="a-btn a-btn--primary"
                disabled={!reason || queueBusy}
                onClick={() => runQueueAction('resolve')}
              >
                Xử lý báo cáo
              </button>
              <button
                type="button"
                className="a-btn a-btn--outline"
                disabled={!reason || queueBusy}
                onClick={() => runQueueAction('dismiss')}
              >
                Bỏ qua
              </button>
            </>
          )}
          <button type="button" className="a-btn a-btn--ghost" onClick={() => openTheatre(item.code)}>
            {isPending ? 'Xem rạp' : 'Mở rạp'}
            <Icon name="external" size={13} />
          </button>
        </div>
      </div>
    );
  }

  function renderQueue() {
    return (
      <section
        className="a-split"
        data-mobile-detail={narrow && mobileDetail ? '1' : '0'}
      >
        <div className="a-list-col">
          <div className="a-list-head">
            <div className="a-tabs" role="tablist" aria-label="Lọc hàng đợi">
              <button
                type="button"
                role="tab"
                className="a-tab"
                aria-current={queueFilter === 'all' ? 'page' : 'false'}
                onClick={() => setQueueFilter('all')}
              >
                Tất cả <span>{queueItems.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                className="a-tab"
                aria-current={queueFilter === 'report' ? 'page' : 'false'}
                onClick={() => setQueueFilter('report')}
              >
                Báo cáo <span>{queueItems.filter((item) => item.kind === 'report').length}</span>
              </button>
              <button
                type="button"
                role="tab"
                className="a-tab"
                aria-current={queueFilter === 'pending' ? 'page' : 'false'}
                onClick={() => setQueueFilter('pending')}
              >
                Chờ duyệt <span>{queueItems.filter((item) => item.kind === 'pending').length}</span>
              </button>
            </div>
            <p className="a-list-sub">
              {filteredQueue.length} việc · cũ nhất {ago(filteredQueue[0]?.at)}
            </p>
          </div>
          <div className="a-list-scroll">{queueState()}</div>
        </div>
        <div className="a-detail-col">{renderDetail(selectedItem)}</div>
      </section>
    );
  }

  function renderTheatres() {
    const statuses = [
      ['all', 'Tất cả', theatres.length],
      ['pending_review', 'Chờ duyệt', theatres.filter((item) => item.status === 'pending_review').length],
      ['open', 'Mở', theatres.filter((item) => item.status === 'open').length],
      ['closed', 'Đóng', theatres.filter((item) => item.status === 'closed').length],
    ];
    return (
      <section className="panel">
        <header className="panel__head">
          <h2>Rạp</h2>
          <span>{filteredTheatres.length} rạp</span>
        </header>
        <div className="a-toolbar">
          <div className="a-tabs">
            {statuses.map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                className="a-tab"
                aria-current={theatreFilter === value ? 'page' : 'false'}
                onClick={() => setTheatreFilter(value)}
              >
                {label} <span>{count}</span>
              </button>
            ))}
          </div>
        </div>
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
              {filteredTheatres.map((theatre) => (
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
                        {theatre.status === 'open' ? 'Mở' : theatre.status === 'closed' ? 'Đóng' : theatre.status}
                      </span>
                    )}
                  </td>
                  <td>{theatre.online}</td>
                  <td>
                    {theatre.status === 'pending_review' ? (
                      <button
                        type="button"
                        className="card-btn"
                        onClick={() => openPendingQueue(theatre)}
                      >
                        Xem hàng đợi
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="card-btn"
                          disabled={busy === `theatre:${theatre.id}`}
                          onClick={() =>
                            theatreStatus(theatre, theatre.status === 'open' ? 'closed' : 'open')
                          }
                        >
                          {theatre.status === 'open' ? 'Đóng' : 'Mở'}
                        </button>
                        <button
                          type="button"
                          className="card-btn card-btn--danger"
                          disabled={busy === `theatre:${theatre.id}`}
                          onClick={() => theatreStatus(theatre, 'delete')}
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
        {filteredTheatres.length === 0 ? <p className="empty">Không có rạp nào khớp.</p> : null}
      </section>
    );
  }

  function renderUsers() {
    return (
      <section className="panel">
        <header className="panel__head">
          <h2>Người dùng</h2>
          <span>{filteredUsers.length} tài khoản</span>
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
              {filteredUsers.map((person) => (
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
                  <td>{ago(person.createdAt, false)}</td>
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
                      onClick={() => askBanUser(person)}
                    >
                      {person.banned ? 'Bỏ khoá' : 'Khoá'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredUsers.length === 0 ? <p className="empty">Không có tài khoản nào khớp.</p> : null}
      </section>
    );
  }

  function renderLive() {
    return (
      <section className="panel">
        <header className="panel__head">
          <h2>Đang trong rạp</h2>
          <span>{rooms.length} rạp có người</span>
        </header>
        {rooms.length === 0 ? (
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
                {rooms.flatMap((room) =>
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
    );
  }

  function renderHistory() {
    const tabs = [
      ['audit', 'Audit log', filteredAudit.length],
      ['moderation', 'Kiểm duyệt', filteredModeration.length],
      ['reports', 'Báo cáo', filteredReports.length],
    ];
    return (
      <section className="panel">
        <header className="panel__head">
          <h2>Lịch sử</h2>
          <span>{TITLES.history}</span>
        </header>
        <div className="a-toolbar">
          <div className="a-tabs">
            {tabs.map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                className="a-tab"
                aria-current={historyTab === value ? 'page' : 'false'}
                onClick={() => setHistoryTab(value)}
              >
                {label} <span>{count}</span>
              </button>
            ))}
          </div>
        </div>
        {historyTab === 'audit' ? (
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
                {filteredAudit.map((entry) => (
                  <tr key={entry.id}>
                    <td>{ago(entry.at, false)}</td>
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
        ) : null}
        {historyTab === 'moderation' ? (
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
                {filteredModeration.map((entry) => (
                  <tr key={entry.id}>
                    <td>{ago(entry.at, false)}</td>
                    <td>{entry.email}</td>
                    <td>{entry.name}</td>
                    <td>
                      <span
                        className={`state ${
                          entry.verdict === 'blocked' ? 'state--muted' : 'state--live'
                        }`}
                      >
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
        ) : null}
        {historyTab === 'reports' ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Lúc</th>
                  <th>Rạp</th>
                  <th>Người gửi</th>
                  <th>Lý do</th>
                  <th>Trạng thái</th>
                  <th>Xử lý</th>
                </tr>
              </thead>
              <tbody>
                {filteredReports.map((report) => (
                  <tr key={report.id}>
                    <td>{ago(report.at, false)}</td>
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
                      {report.status === 'open'
                        ? 'Chờ trong hàng đợi'
                        : report.resolutionReason || report.resolvedBy || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    );
  }

  function renderContent() {
    if (!overview && loading) return <p className="admin__loading">Đang tải số liệu…</p>;
    if (!overview && error) {
      return (
        <div className="a-state" role="alert">
          <p className="a-state__title">Không tải được bảng điều khiển</p>
          <p>{error}</p>
          <button type="button" className="a-btn a-btn--outline" onClick={refresh}>
            <Icon name="refresh" size={14} />
            Thử lại
          </button>
        </div>
      );
    }
    if (view === 'overview') return renderOverview();
    if (view === 'queue') return renderQueue();
    if (view === 'theatres') return renderTheatres();
    if (view === 'users') return renderUsers();
    if (view === 'live') return renderLive();
    return renderHistory();
  }

  function Sidebar({ mobile = false }) {
    return (
      <aside className={`a-side ${mobile ? 'a-side--mobile' : ''}`} aria-label="Điều hướng quản trị">
        <div className="a-brand">
          <Ring />
          <div>
            <strong>Rạp Ảo</strong>
            <span>Quản trị</span>
          </div>
        </div>
        <nav className="a-nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`a-nav__item ${view === item.id ? 'is-active' : ''}`}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => changeView(item.id)}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
              {item.id === 'queue' && queueCount ? (
                <span className="a-nav__count">{queueCount}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="a-side-foot">
          <span className="a-avatar">{String(user?.name || 'A').slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user?.name || 'Quản trị viên'}</strong>
            <span>{user?.email}</span>
          </div>
          <button type="button" className="a-icon-btn" onClick={logout} aria-label="Đăng xuất">
            <Icon name="exit" size={15} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <div className="a-shell">
      <Sidebar />
      <div className="a-main">
        <header className="a-topbar">
          <button
            type="button"
            className="a-icon-btn a-menu"
            onClick={() => setMobileNav(true)}
            aria-label="Mở menu"
          >
            <Icon name="menu" size={18} />
          </button>
          <h1>{TITLES[view]}</h1>
          <div className="a-topbar__right">
            {view !== 'overview' ? (
              <label className="a-search">
                <Icon name="search" size={15} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={SEARCH_PLACEHOLDERS[view]}
                  aria-label="Tìm kiếm"
                />
              </label>
            ) : null}
            <span className="a-live">
              <span className="a-live__dot" />
              Trực tiếp
            </span>
            <button
              type="button"
              className="a-icon-btn"
              onClick={refresh}
              aria-label="Làm mới"
            >
              <Icon name="refresh" size={16} />
            </button>
          </div>
        </header>
        <main className="a-content">
          {error && overview ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          {renderContent()}
        </main>
      </div>

      {mobileNav ? (
        <>
          <button
            type="button"
            className="a-scrim"
            aria-label="Đóng menu"
            onClick={() => setMobileNav(false)}
          />
          <Sidebar mobile />
        </>
      ) : null}

      <Dialog open={!!confirm} title={confirm?.title || ''} onClose={() => setConfirm(null)}>
        <p className="dialog__note">{confirm?.message}</p>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={() => setConfirm(null)}>
            Huỷ
          </button>
          <button
            type="button"
            className={`btn ${confirm?.danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={async () => {
              const run = confirm?.onConfirm;
              setConfirm(null);
              if (run) await run();
            }}
          >
            {confirm?.label || 'Xác nhận'}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
