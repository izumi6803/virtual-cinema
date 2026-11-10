import { lazy, Suspense, useEffect, useState } from 'react';
import AuthScreen from './components/AuthScreen.jsx';
import TheatreList from './components/TheatreList.jsx';
import { useAuth } from './lib/auth.js';

const CinemaView = lazy(() => import('./components/CinemaView.jsx'));

function readRoomCode() {
  const match = window.location.hash.match(/^#\/r\/([A-Za-z0-9]{1,8})$/);
  return match ? match[1].toUpperCase() : '';
}

export default function App() {
  const auth = useAuth();
  const [room, setRoom] = useState(null);
  const [pendingCode, setPendingCode] = useState(readRoomCode);

  useEffect(() => {
    if (!room) return;
    const target = `#/r/${room.id}`;
    if (window.location.hash !== target) window.history.pushState(null, '', target);
  }, [room]);

  useEffect(() => {
    const onPop = () => {
      const code = readRoomCode();
      if (room && code !== room.id) setRoom(null);
      setPendingCode(code);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [room]);

  function enterRoom(nextRoom) {
    setPendingCode('');
    setRoom(nextRoom);
  }

  function leaveRoom() {
    setRoom(null);
    setPendingCode('');
    if (readRoomCode()) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  if (auth.loading) return <div className="boot">Đang mở rạp…</div>;
  if (!auth.user) return <AuthScreen auth={auth} />;
  if (room) {
    return (
      <Suspense fallback={<div className="boot">Đang mở rạp…</div>}>
        <CinemaView initialRoom={room} token={auth.token} user={auth.user} onLeave={leaveRoom} />
      </Suspense>
    );
  }
  return <TheatreList auth={auth} onEnter={enterRoom} initialCode={pendingCode} />;
}
