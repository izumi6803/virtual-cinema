import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';

function clockLabel(timestamp) {
  return new Date(timestamp).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ChatPanel({ open, messages, myId, onSend, onClose }) {
  const [text, setText] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, open]);

  function submit(event) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText('');
  }

  return (
    <aside
      className={`chat ${open ? 'is-open' : ''}`}
      aria-hidden={!open}
      inert={open ? undefined : ''}
    >
      <header className="chat__head">
        <div>
          <h2>Trò chuyện</h2>
          <p>Chỉ người ngồi gần mới thấy tin nhắn của bạn.</p>
        </div>
        <button type="button" className="icon-btn icon-btn--ghost" onClick={onClose} aria-label="Đóng chat">
          ×
        </button>
      </header>

      <div className="chat__list">
        {messages.length === 0 ? (
          <p className="chat__empty">Chưa có ai nói gì. Thử chào người bên cạnh xem.</p>
        ) : (
          messages.map((message) =>
            message.kind === 'system' ? (
              <p key={message.id} className="msg msg--system">
                {message.text}
              </p>
            ) : (
              <article
                key={message.id}
                className={`msg ${message.userId === myId ? 'msg--own' : ''}`}
              >
                <header>
                  <span className="msg__name">{message.name}</span>
                  <time className="msg__time" dateTime={new Date(message.ts).toISOString()}>
                    {clockLabel(message.ts)}
                  </time>
                </header>
                <p>{message.text}</p>
              </article>
            ),
          )
        )}
        <div ref={endRef} />
      </div>

      <form className="chat__form" onSubmit={submit}>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Nói với người bên cạnh…"
          maxLength={500}
          aria-label="Nội dung tin nhắn"
        />
        <button type="submit" className="icon-btn icon-btn--send" aria-label="Gửi">
          <Icon name="send" size={17} />
        </button>
      </form>
    </aside>
  );
}
