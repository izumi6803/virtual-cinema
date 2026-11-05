import { io } from 'socket.io-client';
import { syncClock } from '../lib/clock.js';

export const socket = io({ autoConnect: false });

export function connectSocket(token) {
  socket.auth = { token };
  if (socket.connected) socket.disconnect();
  socket.connect();
}

socket.on('connect', () => {
  syncClock(socket).catch(() => {});
});
