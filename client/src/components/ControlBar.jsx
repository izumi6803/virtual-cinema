import { useState } from 'react';
import { formatTime } from '../lib/format.js';
import { Icon } from './Icons.jsx';

export default function ControlBar({
  isHost,
  playing,
  time,
  duration,
  movieMuted,
  micOn,
  muted,
  voiceCount,
  chatOpen,
  onTogglePlay,
  onSeek,
  onToggleMovieMute,
  onToggleMic,
  onToggleMute,
  onToggleChat,
}) {
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);

  const max = Math.max(duration, 0.1);
  const shown = scrubbing ? scrubValue : Math.min(time, duration || 0);

  function commit(value) {
    setScrubbing(false);
    onSeek(Number(value));
  }

  return (
    <footer className="dock">
      <button
        type="button"
        className="dock__play"
        onClick={onTogglePlay}
        disabled={!isHost}
        title={isHost ? (playing ? 'Tạm dừng' : 'Phát') : 'Chỉ chủ phòng điều khiển được'}
        aria-label={playing ? 'Tạm dừng' : 'Phát'}
      >
        <Icon name={playing ? 'pause' : 'play'} size={20} />
      </button>

      <div className="timeline">
        <span className="timeline__time">{formatTime(shown)}</span>
        <input
          type="range"
          min={0}
          max={max}
          step={0.1}
          value={shown}
          disabled={!isHost || duration <= 0}
          aria-label="Tua phim"
          onPointerDown={() => {
            if (!isHost) return;
            setScrubbing(true);
            setScrubValue(time);
          }}
          onChange={(event) => {
            if (!isHost) return;
            setScrubbing(true);
            setScrubValue(Number(event.target.value));
          }}
          onPointerUp={(event) => commit(event.currentTarget.value)}
          onKeyUp={(event) => commit(event.currentTarget.value)}
        />
        <span className="timeline__time">{formatTime(duration)}</span>
      </div>

      <div className="dock__right">
        <button
          type="button"
          className="dock-btn"
          onClick={onToggleMovieMute}
          title={movieMuted ? 'Bật tiếng phim' : 'Tắt tiếng phim'}
          aria-label={movieMuted ? 'Bật tiếng phim' : 'Tắt tiếng phim'}
        >
          <Icon name={movieMuted ? 'volumeOff' : 'volume'} />
        </button>

        <button
          type="button"
          className={`dock-btn ${micOn ? 'is-active' : ''}`}
          onClick={onToggleMic}
          title={micOn ? 'Tắt micro' : 'Bật micro'}
          aria-label={micOn ? 'Tắt micro' : 'Bật micro'}
        >
          <Icon name={micOn ? 'mic' : 'micOff'} />
          {voiceCount > 0 ? <span className="dock-btn__badge">{voiceCount}</span> : null}
        </button>

        {micOn ? (
          <button
            type="button"
            className={`dock-btn ${muted ? '' : 'is-live'}`}
            onClick={onToggleMute}
            title={muted ? 'Bỏ tắt tiếng' : 'Tắt tiếng micro'}
            aria-label={muted ? 'Bỏ tắt tiếng' : 'Tắt tiếng micro'}
          >
            <span className="live-dot" />
            {muted ? 'Đang tắt' : 'Đang nói'}
          </button>
        ) : null}

        <button
          type="button"
          className={`dock-btn ${chatOpen ? 'is-active' : ''}`}
          onClick={onToggleChat}
          title="Trò chuyện"
          aria-label="Trò chuyện"
        >
          <Icon name="chat" />
        </button>
      </div>
    </footer>
  );
}
