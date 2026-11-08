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

Socket.IO, 30 concurrent clients (room capacity) joining the same room:

| Metric | p50 | p95 | p99 |
| --- | --- | --- | --- |
| WebSocket connect | 26.8 ms | 27.9 ms | 28.0 ms |
| `time:sync` ack | 2.8 ms | 3.3 ms | 3.6 ms |
| `room:join` ack | 32.5 ms | 80.1 ms | 83.2 ms |
| `video:control` broadcast to all clients | 2.3 ms | 3.1 ms | 3.2 ms |

Notes: numbers are from a single local process with the JSON store; they show
server overhead, not production capacity. A 100-client test connected and
survived, but only the first 30 could join — the rest are correctly rejected
because `MAX_ROOM_SIZE` caps a room at 30 viewers.
