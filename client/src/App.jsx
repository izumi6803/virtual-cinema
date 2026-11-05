import { useState } from 'react';
import AuthScreen from './components/AuthScreen.jsx';
import CinemaView from './components/CinemaView.jsx';
import TheatreList from './components/TheatreList.jsx';
import { useAuth } from './lib/auth.js';

export default function App() {
  const auth = useAuth();
  const [room, setRoom] = useState(null);

  if (auth.loading) return <div className="boot">Đang mở rạp…</div>;
  if (!auth.user) return <AuthScreen auth={auth} />;
  if (room) return <CinemaView initialRoom={room} onLeave={() => setRoom(null)} />;
  return <TheatreList auth={auth} onEnter={setRoom} />;
}
