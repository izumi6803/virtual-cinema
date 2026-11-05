import { useEffect, useState } from 'react';

function Meter({ level }) {
  const bars = Math.max(0, Math.min(4, Math.round(level * 70)));
  return (
    <span className="mic-meter" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <i key={index} className={index < bars ? 'is-on' : ''} />
      ))}
    </span>
  );
}

export default function VoiceStatus({ voiceRef, micOn, muted, onResume }) {
  const [state, setState] = useState({ local: 0, remote: 0, peers: 0, blocked: false });

  useEffect(() => {
    const timer = setInterval(() => {
      const voice = voiceRef.current;
      if (!voice) return;
      const levels = voice.getLevels();
      const blocked = voice.isAudioBlocked();
      setState({
        local: Math.round(levels.local * 200) / 200,
        remote: Math.round(levels.remote * 200) / 200,
        peers: levels.peers,
        blocked,
      });
    }, 200);
    return () => clearInterval(timer);
  }, [voiceRef]);

  if (state.blocked && (micOn || state.peers > 0)) {
    return (
      <div className="voice-status voice-status--warn">
        <span className="voice-status__dot" />
        <span>Trình duyệt đang chặn âm thanh</span>
        <button type="button" className="voice-status__btn" onClick={onResume}>
          Bật âm thanh
        </button>
      </div>
    );
  }

  if (micOn && muted) {
    return (
      <div className="voice-status voice-status--warn">
        <span className="voice-status__dot" />
        <span>Micro đang tắt tiếng</span>
      </div>
    );
  }

  if (micOn && state.local < 0.003) {
    return (
      <div className="voice-status voice-status--warn">
        <span className="voice-status__dot" />
        <span>Micro chưa nhận âm thanh</span>
      </div>
    );
  }

  if (micOn) {
    return (
      <div className="voice-status voice-status--live">
        <span className="voice-status__dot" />
        <span>Đang nói · {state.peers} người đang nghe</span>
        <Meter level={state.local} />
      </div>
    );
  }

  if (state.peers > 0 && state.remote > 0.003) {
    return (
      <div className="voice-status voice-status--live">
        <span className="voice-status__dot" />
        <span>Đang nghe người xung quanh</span>
        <Meter level={state.remote} />
      </div>
    );
  }

  if (state.peers > 0) {
    return (
      <div className="voice-status voice-status--idle">
        <span className="voice-status__dot" />
        <span>Voice đã kết nối · {state.peers} người</span>
      </div>
    );
  }

  return null;
}
