# Load test

Small scripts used to measure API and realtime behaviour. Run against a local
server (`npm start` in `server/`, `PORT=3001`).

```bash
cd loadtest
npm init -y
npm i autocannon socket.io-client

# 1. Create a throwaway user + theatre, print { token, theatreId }
node setup.js

# 2. HTTP load (50 connections, 10 s per endpoint)
TOKEN=<token> node http-load.js

# 3. Socket.IO load (room capacity is MAX_ROOM_SIZE = 30)
TOKEN=<token> THEATRE_ID=<theatreId> node socket-load.js
```

## Results (local, Node 22, single process)

HTTP, 50 connections, 10 s each:

| Endpoint | req/s | p50 | p95 | p99 |
| --- | --- | --- | --- | --- |
| `GET /health` | ~4.9k | 6 ms | 44 ms | 54 ms |
| `GET /api/theatres` (auth) | ~3.5k | 13 ms | 21 ms | 23 ms |
| `GET /api/auth/me` (auth) | ~3.7k | 12 ms | 23 ms | 25 ms |

Socket.IO, 60 concurrent clients (full room capacity) joining the same room:

| Metric | p50 | p95 | p99 |
| --- | --- | --- | --- |
| WebSocket connect | 45.6 ms | 48.4 ms | 48.6 ms |
| `time:sync` ack | 6.2 ms | 8.6 ms | 9.1 ms |
| `room:join` ack | 77.2 ms | 174.9 ms | 182.1 ms |
| `video:control` broadcast to all clients | 1.7 ms | 2.8 ms | 2.9 ms |

Notes: numbers are from a single local process with the JSON store; they show
server overhead, not production capacity. A room holds up to
`MAX_ROOM_SIZE` viewers (default = 60, the seat count; override with the
`MAX_ROOM_SIZE` env var, e.g. 30 to reduce WebRTC mesh pressure).
