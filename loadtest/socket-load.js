// Socket.IO load test: connect N clients, time-sync, join a room, measure
// video:control broadcast latency to every client.
// Usage: npm i socket.io-client && TOKEN=... THEATRE_ID=... node socket-load.js
const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const TOKEN = process.env.TOKEN;
const THEATRE_ID = process.env.THEATRE_ID;
const N = Number(process.env.CLIENTS || 30);

const now = () => Number(process.hrtime.bigint()) / 1e6;
const connectMs = [], syncMs = [], joinMs = [], broadcastMs = [];
let ok = { connect: 0, sync: 0, join: 0, state: 0 };

function stats(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), max: +s[s.length - 1].toFixed(1) };
}

(async () => {
  if (!TOKEN || !THEATRE_ID) throw new Error('TOKEN and THEATRE_ID are required');
  const clients = [];
  for (let i = 0; i < N; i++) {
    const s = io(BASE, { auth: { token: TOKEN }, transports: ['websocket'], reconnection: false, timeout: 8000 });
    clients.push(s);
    s.on('room:state', () => { if (s._emitAt) { broadcastMs.push(now() - s._emitAt); ok.state++; s._emitAt = 0; } });
  }

  await Promise.all(clients.map((s) => new Promise((resolve) => {
    const t0 = now();
    s.on('connect', () => {
      connectMs.push(now() - t0); ok.connect++;
      const t1 = now();
      s.emit('time:sync', Date.now(), () => {
        syncMs.push(now() - t1); ok.sync++;
        const t2 = now();
        s.emit('room:join', { theatreId: THEATRE_ID }, (res) => {
          joinMs.push(now() - t2);
          if (res && res.ok) ok.join++;
          resolve();
        });
      });
    });
    s.on('connect_error', resolve);
  })));

  const t = now();
  for (const s of clients) s._emitAt = t;
  clients[0].emit('video:control', { action: 'play', time: 0 }, () => {});
  await new Promise((r) => setTimeout(r, 2500));

  console.log(JSON.stringify({ clients: N, ok, connect: stats(connectMs), timeSync: stats(syncMs), roomJoin: stats(joinMs), videoBroadcast: stats(broadcastMs) }, null, 2));
  for (const s of clients) { try { s.disconnect(); } catch {} }
  process.exit(0);
})();
