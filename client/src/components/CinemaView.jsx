import { useEffect, useMemo, useRef, useState } from 'react';
import { effectiveTime } from '../lib/clock.js';
import { seatDistance, seatLabel } from '../lib/layout.js';
import { api } from '../net/api.js';
import { socket } from '../net/socket.js';
import { VoiceChat } from '../net/voice.js';
import { CinemaScene } from '../three/CinemaScene.js';
import { createPlayer } from '../video/createPlayer.js';
import ChatPanel from './ChatPanel.jsx';
import ControlBar from './ControlBar.jsx';
import { Icon } from './Icons.jsx';
import VoiceStatus from './VoiceStatus.jsx';

export default function CinemaView({ initialRoom, token, onLeave }) {
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
  const mySeat = room.users.find((user) => user.id === socket.id)?.seatId || null;
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
    };
    const onConnect = () => {
      if (!state.disconnected) return;
      state.disconnected = false;
      const current = roomRef.current;
      if (!current?.theatreId) return;
      socket.timeout(6000).emit('room:join', { theatreId: current.theatreId }, (error, response) => {
        if (error || !response?.ok) {
          setToast('Không vào lại được rạp.');
          setTimeout(onLeave, 1200);
          return;
        }
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
    const onClosed = (payload) => {
      setToast(payload?.reason || 'Rạp đã đóng.');
      setTimeout(onLeave, 1200);
    };
    socket.on('room:closed', onClosed);
    return () => socket.off('room:closed', onClosed);
  }, [onLeave]);

  useEffect(() => {
    const onKicked = (payload) => {
      setToast(payload?.reason || 'Bạn đã bị đưa ra khỏi rạp.');
      setTimeout(onLeave, 1200);
    };
    socket.on('room:kicked', onKicked);
    return () => socket.off('room:kicked', onKicked);
  }, [onLeave]);

  useEffect(() => {
    const scene = new CinemaScene(canvasRef.current, {
      onSeatClick: (seatId) => {
        socket.emit('seat:claim', { seatId }, (response) => {
          if (response && !response.ok) setToast(response.error || 'Không chọn được ghế.');
        });
      },
    });
    sceneRef.current = scene;
    scene.setRoomState(roomRef.current, socket.id);
    return () => {
      sceneRef.current = null;
      scene.dispose();
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
    socket.on('disconnect', teardown);
    socket.on('connect', spawn);
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);

    return () => {
      clearInterval(timer);
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
      if (!current || current.hostId === socket.id || !current.video.playing) return;
      const target = effectiveTime(current.video);
      const actual = player.getTime();
      if (Math.abs(actual - target) > 1.4) player.seek(target);
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

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(room.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setToast(`Mã phòng: ${room.id}`);
    }
  }

  function sendChat(text) {
    socket.emit('chat:send', { text }, (response) => {
      if (response && !response.ok) {
        setToast(response.error || 'Không gửi được tin nhắn.');
      }
    });
  }

  async function reportTheatre() {
    const reason = window.prompt('Mô tả vi phạm (gửi tới quản trị viên):');
    if (!reason) return;
    try {
      await api(`/api/theatres/${room.id}/report`, {
        method: 'POST',
        token,
        body: { reason },
      });
      setToast('Đã gửi báo cáo. Cảm ơn bạn.');
    } catch (err) {
      setToast(err.message);
    }
  }

  function nudgePlayback() {
    voiceRef.current?.resume();
    const player = playerRef.current;
    if (!player) return;
    if (roomRef.current.video.playing && !player.isPlaying()) player.play();
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
          <span className={`chip ${isHost ? 'chip--host' : ''}`}>
            {isHost ? 'Chủ phòng' : 'Khán giả'}
          </span>
          <span className="chip chip--seat">
            <Icon name="seat" size={14} />
            {seatLabel(mySeat)}
          </span>
          <button type="button" className="icon-btn" onClick={copyCode}>
            <Icon name="copy" size={15} />
            {copied ? 'Đã chép' : room.id}
          </button>
          <button type="button" className="icon-btn" onClick={reportTheatre} title="Báo cáo rạp">
            <Icon name="flag" size={15} />
            Báo cáo
          </button>
          <button type="button" className="icon-btn icon-btn--danger" onClick={handleLeave}>
            <Icon name="exit" size={16} />
            Rời rạp
          </button>
        </div>
      </header>

      {!mySeat ? (
        <div className="seat-hint">Bấm vào một ghế trống để ngồi xuống</div>
      ) : null}

      {voiceHint ? (
        <div className="voice-hint">
          Bạn đang nghe voice quanh ghế. Bấm micro để nói.
        </div>
      ) : null}

      <VoiceStatus
        voiceRef={voiceRef}
        micOn={micOn}
        muted={muted}
        onResume={async () => {
          await voiceRef.current?.resume();
          voiceRef.current?.playTestTone();
        }}
      />

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
        onTogglePlay={togglePlay}
        onSeek={seekTo}
        onToggleMovieMute={toggleMovieMute}
        onToggleMic={toggleMic}
        onToggleMute={toggleMute}
        onToggleChat={() => setChatOpen((open) => !open)}
      />

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
