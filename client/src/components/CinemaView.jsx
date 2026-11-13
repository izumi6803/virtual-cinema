import { useEffect, useMemo, useRef, useState } from 'react';
import { effectiveTime } from '../lib/clock.js';
import { seatDistance, seatLabel, SEAT_COLS, SEAT_ROWS } from '../lib/layout.js';
import { api } from '../net/api.js';
import { socket } from '../net/socket.js';
import { VoiceChat } from '../net/voice.js';
import { useWakeLock } from '../lib/wakeLock.js';
import { createPlayer } from '../video/createPlayer.js';
import ChatPanel from './ChatPanel.jsx';
import ControlBar from './ControlBar.jsx';
import Dialog from './Dialog.jsx';
import { Icon } from './Icons.jsx';
import VoiceStatus from './VoiceStatus.jsx';

export default function CinemaView({ initialRoom, token, user, onLeave }) {
  const [room, setRoom] = useState(initialRoom);
  const [messages, setMessages] = useState([]);
  const [chatOpen, setChatOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1000,
  );
  const [micOn, setMicOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [movieMuted, setMovieMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [toast, setToast] = useState('');
  const [copied, setCopied] = useState(false);
  const [voiceHint, setVoiceHint] = useState(true);
  const [unread, setUnread] = useState(0);
  const [seatOpen, setSeatOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [personTarget, setPersonTarget] = useState(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferEmail, setTransferEmail] = useState('');
  const [manageBusy, setManageBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [netState, setNetState] = useState('online');
  const [syncState, setSyncState] = useState('ok');
  const [dialogError, setDialogError] = useState('');
  const [notice, setNotice] = useState(null);
  const autoSeatRef = useRef(false);
  const lastSeatRef = useRef(null);

  useWakeLock(room.video.playing);

  const canvasRef = useRef(null);
  const overlayHostRef = useRef(null);
  const sceneRef = useRef(null);
  const playerRef = useRef(null);
  const voiceRef = useRef(null);
  const roomRef = useRef(initialRoom);
  const chatOpenRef = useRef(chatOpen);
  const shortcutRef = useRef(null);

  roomRef.current = room;
  chatOpenRef.current = chatOpen;

  const isHost = room.hostId === socket.id;
  const isOwner = Boolean(user?.id && room.ownerId === user.id);
  const canModerate = Boolean(
    user && (user.role === 'admin' || isOwner || (room.moderators || []).includes(user.id)),
  );
  const mySeat = room.users.find((member) => member.id === socket.id)?.seatId || null;
  const voiceCount = room.users.filter((user) => user.speaking).length;

  const visibleMessages = useMemo(
    () =>
      messages.filter((message) => {
        if (message.kind === 'system') return true;
        if (message.userId === socket.id) return true;
        if (!mySeat || !message.seatId) return true;
        return seatDistance(mySeat, message.seatId) <= 4.6;
      }),
    [messages, mySeat],
  );

  const takenSeats = useMemo(
    () => new Set(room.users.map((user) => user.seatId).filter(Boolean)),
    [room.users],
  );

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (chatOpen) setUnread(0);
  }, [chatOpen]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented) return;
      const tag = event.target?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        event.target?.isContentEditable
      ) {
        return;
      }
      if (event.target?.closest?.('button, a, [role="button"]')) return;
      const handlers = shortcutRef.current;
      if (!handlers) return;
      if (event.code === 'Space') {
        if (!handlers.isHost) return;
        event.preventDefault();
        handlers.togglePlay();
      } else if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        handlers.toggleMovieMute();
      } else if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        handlers.toggleChat();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setVoiceHint(false), 7000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const onState = (next) => setRoom(next);
    const onChat = (message) => {
      setMessages((previous) => [...previous.slice(-120), message]);
      if (!chatOpenRef.current) setUnread((count) => count + 1);
    };
    const onSystem = (payload) =>
      setMessages((previous) => [
        ...previous.slice(-120),
        {
          id: `system-${Date.now()}-${Math.random()}`,
          kind: 'system',
          text: payload?.text || '',
          ts: Date.now(),
        },
      ]);

    socket.on('room:state', onState);
    socket.on('chat:message', onChat);
    socket.on('system', onSystem);
    return () => {
      socket.off('room:state', onState);
      socket.off('chat:message', onChat);
      socket.off('system', onSystem);
    };
  }, []);

  useEffect(() => {
    const state = { disconnected: false };
    const onDisconnect = () => {
      state.disconnected = true;
      autoSeatRef.current = false;
      setNetState('offline');
    };
    const onConnect = () => {
      if (!state.disconnected) return;
      state.disconnected = false;
      setNetState('reconnecting');
      const current = roomRef.current;
      if (!current?.theatreId) {
        setNetState('online');
        return;
      }
      socket.timeout(6000).emit('room:join', { theatreId: current.theatreId }, (error, response) => {
        if (error || !response?.ok) {
          setNetState('offline');
          setNotice({
            title: 'Không vào lại được rạp',
            message: 'Kết nối đã bị gián đoạn. Thử lại hoặc quay về sảnh rạp.',
            retry: true,
          });
          return;
        }
        setNetState('online');
        setRoom(response.room);
      });
    };
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    return () => {
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
  }, [onLeave]);

  useEffect(() => {
    const onOnline = () => setNetState(socket.connected ? 'online' : 'reconnecting');
    const onOffline = () => setNetState('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const onClosed = (payload) => {
      setNotice({
        title: 'Rạp đã đóng',
        message: payload?.reason || 'Người điều khiển đã đóng rạp.',
      });
    };
    socket.on('room:closed', onClosed);
    return () => socket.off('room:closed', onClosed);
  }, []);

  useEffect(() => {
    const onKicked = (payload) => {
      setNotice({
        title: 'Bạn đã ra khỏi rạp',
        message: payload?.reason || 'Bạn đã bị đưa ra khỏi rạp.',
      });
    };
    socket.on('room:kicked', onKicked);
    return () => socket.off('room:kicked', onKicked);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let scene = null;

    import('../three/CinemaScene.js')
      .then(({ CinemaScene }) => {
        if (cancelled || !canvasRef.current) return;
        scene = new CinemaScene(canvasRef.current, {
          onSeatClick: (seatId) => {
            socket.emit('seat:claim', { seatId }, (response) => {
              if (response && !response.ok) setToast(response.error || 'Không chọn được ghế.');
            });
          },
        });
        sceneRef.current = scene;
        scene.setRoomState(roomRef.current, socket.id);

        const player = playerRef.current;
        const host = overlayHostRef.current;
        if (player?.isOverlay && host) {
          const element = player.getOverlayElement();
          host.replaceChildren(element);
          scene.setOverlay(element);
        } else if (player) {
          scene.setScreenTexture(player.getTexture());
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      sceneRef.current = null;
      scene?.dispose();
    };
  }, []);

  useEffect(() => {
    const spawn = () => {
      if (voiceRef.current) return;
      const voice = new VoiceChat({
        socket,
        getSpatial: () => sceneRef.current?.getSpatial(),
      });
      voiceRef.current = voice;
      voice.startListening().catch(() => {});
    };

    const teardown = () => {
      voiceRef.current?.destroy();
      voiceRef.current = null;
      setMicOn(false);
      setMuted(false);
    };

    const unlock = () => voiceRef.current?.resume();

    spawn();
    const timer = setInterval(() => voiceRef.current?.update(), 60);
    let lastLoud = 0;
    const speakTimer = setInterval(() => {
      const voice = voiceRef.current;
      if (!voice) return;
      const now = performance.now();
      const live = voice.enabled && !voice.muted;
      const level = live ? voice.getLevels().local : 0;
      if (level > 0.02) lastLoud = now;
      voice.setSpeaking(live && (level > 0.04 || (voice.speaking && now - lastLoud < 600)));
    }, 300);
    socket.on('disconnect', teardown);
    socket.on('connect', spawn);
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);

    return () => {
      clearInterval(timer);
      clearInterval(speakTimer);
      socket.off('disconnect', teardown);
      socket.off('connect', spawn);
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      teardown();
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setRoomState(room, socket.id);
  }, [room]);

  useEffect(() => {
    if (mySeat) lastSeatRef.current = mySeat;
  }, [mySeat]);

  useEffect(() => {
    if (mySeat || autoSeatRef.current || room.users.length === 0) return;
    let seatId = lastSeatRef.current;
    if (!seatId || takenSeats.has(seatId)) {
      seatId = null;
      for (let row = 0; row < SEAT_ROWS && !seatId; row += 1) {
        for (let col = 0; col < SEAT_COLS; col += 1) {
          const candidate = `${row}-${col}`;
          if (!takenSeats.has(candidate)) {
            seatId = candidate;
            break;
          }
        }
      }
    }
    if (!seatId) return;
    autoSeatRef.current = true;
    socket.emit('seat:claim', { seatId }, (response) => {
      if (response && !response.ok) autoSeatRef.current = false;
    });
  }, [mySeat, room.users.length, takenSeats]);



  function applyVideoState(video) {
    const player = playerRef.current;
    if (!player || !video) return;
    player.ready
      .then(() => {
        if (playerRef.current !== player) return;
        const target = effectiveTime(video);
        const drift = Math.abs(player.getTime() - target);
        if (video.playing) {
          if (drift > 0.8) player.seek(target);
          player.play();
        } else {
          player.pause();
          if (drift > 0.35) player.seek(target);
        }
      })
      .catch(() => {});
  }

  useEffect(() => {
    const video = room.video;
    const scene = sceneRef.current;
    const host = overlayHostRef.current;
    if (!video?.src) return undefined;

    const player = createPlayer(video);
    if (!player) return undefined;

    playerRef.current = player;
    player.onError = () =>
      setToast('Không tải được phim. Kiểm tra đường dẫn và CORS của máy chủ chứa video.');
    setMovieMuted(false);

    if (player.isOverlay) {
      const element = player.getOverlayElement();
      host.replaceChildren(element);
      scene?.setOverlay(element);
    } else {
      host.replaceChildren();
      scene?.setOverlay(null);
      scene?.setScreenTexture(player.getTexture());
    }

    let cancelled = false;
    player.ready.then(() => {
      if (cancelled) return;
      applyVideoState(roomRef.current.video);
    });

    return () => {
      cancelled = true;
      if (playerRef.current === player) playerRef.current = null;
      scene?.setOverlay(null);
      scene?.setScreenTexture(null);
      host.replaceChildren();
      player.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.video.kind, room.video.src]);

  useEffect(() => {
    if (roomRef.current.hostId === socket.id) return;
    applyVideoState(roomRef.current.video);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.video.playing, room.video.baseTime, room.video.baseAt]);

  useEffect(() => {
    const timer = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      setTime(player.getTime());
      setDuration(player.getDuration());

      const current = roomRef.current;
      if (!current) return;
      if (current.hostId === socket.id || !current.video.playing) {
        setSyncState((previous) => (previous === 'ok' ? previous : 'ok'));
        return;
      }

      const target = effectiveTime(current.video);
      const actual = player.getTime();
      const drifting = Math.abs(actual - target) > 1.4;
      const next = drifting || !player.isPlaying() ? 'syncing' : 'ok';
      setSyncState((previous) => (previous === next ? previous : next));
      if (drifting) player.seek(target);
      if (!player.isPlaying()) player.play();
    }, 500);
    return () => clearInterval(timer);
  }, []);

  function togglePlay() {
    const player = playerRef.current;
    if (!player || !isHost) return;
    const playing = roomRef.current.video.playing;
    const currentTime = player.getTime();
    if (playing) player.pause();
    else player.play();
    setTime(currentTime);
    socket.emit('video:control', {
      action: playing ? 'pause' : 'play',
      time: currentTime,
    });
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
        try {
          await screen.orientation?.lock?.('landscape');
        } catch {
          // Orientation lock is best-effort.
        }
      }
    } catch {
      setToast('Trình duyệt không hỗ trợ toàn màn hình.');
    }
  }

  function seekTo(value) {
    if (!isHost) return;
    playerRef.current?.seek(value);
    setTime(value);
    socket.emit('video:control', { action: 'seek', time: value });
  }

  function toggleMovieMute() {
    const next = !movieMuted;
    setMovieMuted(next);
    playerRef.current?.setVolume(next ? 0 : 0.8);
  }

  async function toggleMic() {
    const voice = voiceRef.current;
    if (!voice) return;

    if (micOn) {
      voice.disableMic();
      setMicOn(false);
      setMuted(false);
      return;
    }

    try {
      await voice.enableMic();
      setMicOn(true);
      setMuted(false);
    } catch {
      setToast('Không mở được micro. Kiểm tra quyền truy cập của trình duyệt.');
    }
  }

  function toggleMute() {
    if (!micOn) return;
    const next = !muted;
    setMuted(next);
    voiceRef.current?.setMuted(next);
  }

  function inviteUrl() {
    return `${window.location.origin}${window.location.pathname}#/r/${room.id}`;
  }

  async function shareRoom() {
    const url = inviteUrl();
    if (navigator.share) {
      try {
        await navigator.share({
          title: room.name,
          text: `Vào rạp "${room.name}" trên Rạp Ảo`,
          url,
        });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      setToast('Đã chép liên kết mời.');
    } catch {
      setToast(`Liên kết mời: ${url}`);
    }
  }

  function sendChat(text) {
    socket.emit('chat:send', { text }, (response) => {
      if (response && !response.ok) {
        setToast(response.error || 'Không gửi được tin nhắn.');
      }
    });
  }

  function claimSeat(seatId) {
    socket.emit('seat:claim', { seatId }, (response) => {
      if (response?.ok) {
        setSeatOpen(false);
        setToast(`Bạn đang ở ${seatLabel(seatId)}.`);
      } else {
        setToast(response?.error || 'Không chọn được ghế.');
      }
    });
  }

  async function submitReport(event) {
    event?.preventDefault();
    if (reportBusy || !reportText.trim()) return;
    setReportBusy(true);
    setDialogError('');
    try {
      await api(`/api/theatres/${room.id}/report`, {
        method: 'POST',
        token,
        body: { reason: reportText.trim() },
      });
      setReportOpen(false);
      setReportText('');
      setToast('Đã gửi báo cáo. Cảm ơn bạn.');
    } catch (err) {
      setDialogError(err.message);
    } finally {
      setReportBusy(false);
    }
  }

  async function moderate(action) {
    const target = personTarget;
    if (!target || manageBusy) return;
    setManageBusy(true);
    setDialogError('');
    try {
      if (action === 'mute' || action === 'unmute') {
        await api(`/api/theatres/${room.id}/mute`, {
          method: 'POST',
          token,
          body: { userId: target.accountId, minutes: action === 'mute' ? 10 : 0 },
        });
      } else if (action === 'kick') {
        await api(`/api/theatres/${room.id}/kick`, {
          method: 'POST',
          token,
          body: { userId: target.accountId },
        });
      } else if (action === 'ban') {
        await api(`/api/theatres/${room.id}/ban`, {
          method: 'POST',
          token,
          body: { userId: target.accountId, banned: true },
        });
      } else if (action === 'moderator') {
        const isMod = (room.moderators || []).includes(target.accountId);
        await api(`/api/theatres/${room.id}/moderators`, {
          method: 'POST',
          token,
          body: { userId: target.accountId, action: isMod ? 'remove' : 'add' },
        });
      }
      setToast('Đã cập nhật.');
      setPersonTarget(null);
    } catch (err) {
      setDialogError(err.message);
    } finally {
      setManageBusy(false);
    }
  }

  async function closeRoom() {
    if (manageBusy) return;
    setManageBusy(true);
    setDialogError('');
    try {
      await api(`/api/theatres/${room.id}`, {
        method: 'PATCH',
        token,
        body: { status: 'closed' },
      });
      setCloseOpen(false);
    } catch (err) {
      setDialogError(err.message);
    } finally {
      setManageBusy(false);
    }
  }

  async function transferRoom(event) {
    event?.preventDefault();
    if (manageBusy || !transferEmail.trim()) return;
    setManageBusy(true);
    setDialogError('');
    try {
      await api(`/api/theatres/${room.id}/transfer`, {
        method: 'POST',
        token,
        body: { email: transferEmail.trim() },
      });
      setTransferOpen(false);
      setPeopleOpen(false);
      setTransferEmail('');
      setToast('Đã chuyển nhượng rạp.');
    } catch (err) {
      setDialogError(err.message);
    } finally {
      setManageBusy(false);
    }
  }

  function nudgePlayback() {
    voiceRef.current?.resume();
    const player = playerRef.current;
    if (!player) return;
    if (roomRef.current.video.playing && !player.isPlaying()) player.play();
  }

  function closeNotice() {
    setNotice(null);
    onLeave();
  }

  function retryJoin() {
    const current = roomRef.current;
    if (!current?.theatreId) {
      closeNotice();
      return;
    }
    socket.timeout(6000).emit('room:join', { theatreId: current.theatreId }, (error, response) => {
      if (error || !response?.ok) {
        setNotice({
          title: 'Không vào lại được rạp',
          message: response?.error || 'Máy chủ không phản hồi.',
          retry: true,
        });
        return;
      }
      setNotice(null);
      setNetState('online');
      setRoom(response.room);
    });
  }

  function handleLeave() {
    voiceRef.current?.destroy();
    voiceRef.current = null;
    socket.emit('room:leave');
    onLeave();
  }

  shortcutRef.current = {
    isHost,
    togglePlay,
    toggleMovieMute,
    toggleChat: () => setChatOpen((open) => !open),
  };

  return (
    <div className="cinema" onPointerDownCapture={nudgePlayback}>
      {netState !== 'online' ? (
        <div className="net-banner" role="status" aria-live="polite">
          <span className="net-banner__dot" />
          {netState === 'offline' ? 'Mất kết nối — đang thử lại…' : 'Đang kết nối lại…'}
        </div>
      ) : null}

      <div className="stage">
        <canvas ref={canvasRef} className="stage__canvas" />
        <div className="stage__overlay-host" ref={overlayHostRef} />
      </div>

      <header className="hud">
        <div className="hud__brand">
          <span className="hud__title">{room.name}</span>
          <span className="hud__room">MÃ {room.id}</span>
        </div>

        <div className="hud__meta">
          <button
            type="button"
            className="people-stack"
            onClick={() => setPeopleOpen(true)}
            aria-label={`${room.users.length} người trong rạp, ${voiceCount} đang nói`}
          >
            {room.users.slice(0, 3).map((person) => (
              <span
                key={person.id}
                className={`people-stack__avatar ${person.speaking ? 'is-speaking' : ''}`}
                title={person.name}
              >
                {person.name.slice(0, 1).toUpperCase()}
              </span>
            ))}
            {room.users.length > 3 ? (
              <span className="people-stack__more">+{room.users.length - 3}</span>
            ) : null}
          </button>
          <span className={`chip ${isHost ? 'chip--host' : ''}`}>
            {isHost ? 'Người điều khiển' : 'Khán giả'}
          </span>
          <span className="chip chip--seat">
            <Icon name="seat" size={14} />
            {seatLabel(mySeat)}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={shareRoom}
            title="Mời vào rạp"
            aria-label="Mời vào rạp"
          >
            <Icon name="share" size={15} />
            <span className="hud__label">{copied ? 'Đã chép' : 'Mời'}</span>
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSeatOpen(true)}
            title="Đổi ghế"
            aria-label="Đổi ghế"
          >
            <Icon name="seat" size={15} />
            <span className="hud__label">Đổi ghế</span>
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              setDialogError('');
              setReportOpen(true);
            }}
            title="Báo cáo rạp"
            aria-label="Báo cáo rạp"
          >
            <Icon name="flag" size={15} />
            <span className="hud__label">Báo cáo</span>
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--danger"
            onClick={handleLeave}
            aria-label="Rời rạp"
          >
            <Icon name="exit" size={16} />
            <span className="hud__label">Rời rạp</span>
          </button>
        </div>
      </header>

      {!mySeat ? (
        <button type="button" className="seat-hint" onClick={() => setSeatOpen(true)}>
          Chọn ghế để ngồi xuống
        </button>
      ) : null}

      {voiceHint ? (
        <div className="voice-hint">
          Bạn đang nghe voice quanh ghế. Bấm micro để nói.
        </div>
      ) : null}

      {!chatOpen ? (
        <VoiceStatus
          voiceRef={voiceRef}
          micOn={micOn}
          muted={muted}
          onResume={async () => {
            await voiceRef.current?.resume();
            voiceRef.current?.playTestTone();
          }}
        />
      ) : null}

      {!isHost && syncState === 'syncing' ? (
        <div className="sync-status" role="status">
          Đang đồng bộ phim…
        </div>
      ) : null}

      {chatOpen ? (
        <button
          type="button"
          className="chat-backdrop"
          onClick={() => setChatOpen(false)}
          aria-label="Đóng trò chuyện"
        />
      ) : null}

      <ChatPanel
        open={chatOpen}
        messages={visibleMessages}
        myId={socket.id}
        onSend={sendChat}
        onClose={() => setChatOpen(false)}
      />

      <ControlBar
        isHost={isHost}
        playing={room.video.playing}
        time={time}
        duration={duration}
        movieMuted={movieMuted}
        micOn={micOn}
        muted={muted}
        voiceCount={voiceCount}
        chatOpen={chatOpen}
        unread={unread}
        peopleCount={room.users.length}
        fullscreen={fullscreen}
        onTogglePlay={togglePlay}
        onSeek={seekTo}
        onToggleMovieMute={toggleMovieMute}
        onToggleMic={toggleMic}
        onToggleMute={toggleMute}
        onToggleChat={() => setChatOpen((open) => !open)}
        onTogglePeople={() => setPeopleOpen(true)}
        onToggleFullscreen={toggleFullscreen}
      />

      <Dialog open={seatOpen} title="Chọn ghế" onClose={() => setSeatOpen(false)}>
        <p className="dialog__note">Bấm vào ghế trống để ngồi. Ghế đang có người sẽ bị mờ.</p>
        <div className="seat-grid" role="group" aria-label="Sơ đồ ghế">
          {Array.from({ length: SEAT_ROWS }, (_, row) => (
            <div className="seat-row" key={row}>
              <span className="seat-row__label">Hàng {row + 1}</span>
              {Array.from({ length: SEAT_COLS }, (_, col) => {
                const seatId = `${row}-${col}`;
                const isMine = seatId === mySeat;
                const isTaken = takenSeats.has(seatId) && !isMine;
                return (
                  <button
                    key={seatId}
                    type="button"
                    className={`seat-pick ${isMine ? 'is-mine' : ''}`}
                    disabled={isTaken}
                    onClick={() => claimSeat(seatId)}
                    aria-label={`Hàng ${row + 1} ghế ${col + 1}${isTaken ? ' đã có người' : ''}`}
                  >
                    {col + 1}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={() => setSeatOpen(false)}>
            Đóng
          </button>
        </div>
      </Dialog>

      <Dialog open={reportOpen} title="Báo cáo rạp" onClose={() => setReportOpen(false)}>
        <label className="field">
          <span>Mô tả vi phạm</span>
          <textarea
            value={reportText}
            onChange={(event) => setReportText(event.target.value)}
            maxLength={500}
            rows={4}
            placeholder="Nội dung không phù hợp, phim lậu…"
          />
        </label>
        <p className="dialog__note">Báo cáo được gửi tới quản trị viên.</p>
        {dialogError ? (
          <p className="error" role="alert">
            {dialogError}
          </p>
        ) : null}
        <div className="dialog__actions">
          <button
            type="button"
            className="btn"
            onClick={() => setReportOpen(false)}
            disabled={reportBusy}
          >
            Huỷ
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={submitReport}
            disabled={reportBusy || !reportText.trim()}
          >
            {reportBusy ? 'Đang gửi…' : 'Gửi báo cáo'}
          </button>
        </div>
      </Dialog>

      <Dialog
        open={peopleOpen}
        title={`Mọi người (${room.users.length})`}
        onClose={() => setPeopleOpen(false)}
        sheet
      >
        <ul className="people">
          {room.users.map((person) => {
            const isMe = person.id === socket.id;
            const meta = [
              seatLabel(person.seatId),
              person.accountId === room.ownerId ? 'Chủ rạp' : '',
              person.id === room.hostId ? 'Người điều khiển' : '',
              (room.moderators || []).includes(person.accountId) ? 'Điều phối' : '',
              isMe ? 'Bạn' : '',
              person.speaking ? 'Đang nói' : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li
                key={person.id}
                className={`people__row ${person.speaking ? 'is-speaking' : ''}`}
              >
                <span className="people__avatar" aria-hidden="true">
                  {person.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="people__id">
                  <span className="people__name">{person.name}</span>
                  <span className="people__meta">{meta}</span>
                </span>
                {canModerate && !isMe ? (
                  <button
                    type="button"
                    className="people__more"
                    onClick={() => {
                      setDialogError('');
                      setPersonTarget(person);
                    }}
                    aria-label={`Tuỳ chọn cho ${person.name}`}
                  >
                    ⋯
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>

        {isOwner ? (
          <div className="people__manage">
            <h3>Quản lý rạp</h3>
            <div className="dialog__actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDialogError('');
                  setTransferOpen(true);
                }}
              >
                Chuyển nhượng
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  setDialogError('');
                  setCloseOpen(true);
                }}
              >
                Đóng rạp
              </button>
            </div>
          </div>
        ) : null}

        <div className="dialog__actions">
          <button type="button" className="btn" onClick={() => setPeopleOpen(false)}>
            Đóng
          </button>
        </div>
      </Dialog>

      <Dialog
        open={!!personTarget}
        title={personTarget?.name || ''}
        onClose={() => setPersonTarget(null)}
        sheet
      >
        <p className="dialog__note">{personTarget ? seatLabel(personTarget.seatId) : ''}</p>
        {dialogError ? (
          <p className="error" role="alert">
            {dialogError}
          </p>
        ) : null}
        <div className="person-actions">
          <button
            type="button"
            className="btn"
            onClick={() => moderate('mute')}
            disabled={manageBusy}
          >
            Tắt chat 10 phút
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => moderate('unmute')}
            disabled={manageBusy}
          >
            Bỏ tắt chat
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => moderate('kick')}
            disabled={manageBusy}
          >
            Đưa ra khỏi rạp
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => moderate('ban')}
            disabled={manageBusy}
          >
            Cấm khỏi rạp
          </button>
          {isOwner ? (
            <button
              type="button"
              className="btn"
              onClick={() => moderate('moderator')}
              disabled={manageBusy}
            >
              {(room.moderators || []).includes(personTarget?.accountId)
                ? 'Bỏ điều phối'
                : 'Bổ nhiệm điều phối'}
            </button>
          ) : null}
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={() => setPersonTarget(null)}>
            Huỷ
          </button>
        </div>
      </Dialog>

      <Dialog open={closeOpen} title="Đóng rạp" onClose={() => setCloseOpen(false)}>        <p className="dialog__note">
          Mọi người sẽ được đưa ra khỏi rạp. Bạn có thể mở lại rạp trong Sảnh rạp.
        </p>
        {dialogError ? (
          <p className="error" role="alert">
            {dialogError}
          </p>
        ) : null}
        <div className="dialog__actions">
          <button
            type="button"
            className="btn"
            onClick={() => setCloseOpen(false)}
            disabled={manageBusy}
          >
            Huỷ
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={closeRoom}
            disabled={manageBusy}
          >
            {manageBusy ? 'Đang đóng…' : 'Đóng rạp'}
          </button>
        </div>
      </Dialog>

      <Dialog
        open={transferOpen}
        title="Chuyển nhượng rạp"
        onClose={() => setTransferOpen(false)}
      >
        <label className="field">
          <span>Email người nhận</span>
          <input
            type="email"
            value={transferEmail}
            onChange={(event) => setTransferEmail(event.target.value)}
            placeholder="ban@example.com"
            spellCheck={false}
          />
        </label>
        <p className="dialog__note">Bạn sẽ không còn là chủ rạp này.</p>
        {dialogError ? (
          <p className="error" role="alert">
            {dialogError}
          </p>
        ) : null}
        <div className="dialog__actions">
          <button
            type="button"
            className="btn"
            onClick={() => setTransferOpen(false)}
            disabled={manageBusy}
          >
            Huỷ
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={transferRoom}
            disabled={manageBusy || !transferEmail.trim()}
          >
            {manageBusy ? 'Đang xử lý…' : 'Chuyển nhượng'}
          </button>
        </div>
      </Dialog>

      <Dialog open={!!notice} title={notice?.title || ''} onClose={closeNotice}>
        <p className="dialog__note">{notice?.message}</p>
        <div className="dialog__actions">
          {notice?.retry ? (
            <button type="button" className="btn" onClick={retryJoin}>
              Thử lại
            </button>
          ) : null}
          <button type="button" className="btn btn--primary" onClick={closeNotice}>
            Về sảnh rạp
          </button>
        </div>
      </Dialog>

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
