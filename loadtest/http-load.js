// HTTP load test with autocannon.
// Usage: npm i autocannon && TOKEN=<token> node http-load.js
const autocannon = require('autocannon');

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const TOKEN = process.env.TOKEN || '';
const CONNECTIONS = Number(process.env.CONNECTIONS || 50);
const DURATION = Number(process.env.DURATION || 10);

function run(label, opts) {
  return new Promise((resolve) => {
    autocannon(opts, (err, result) => {
      if (err) { console.error(label, err); return resolve(); }
      console.log(JSON.stringify({
        label,
        rps: Math.round(result.requests.average),
        p50: result.latency.p50,
        p95: result.latency.p97_5,
        p99: result.latency.p99,
        non2xx: result.non2xx,
        errors: result.errors,
      }));
      resolve();
    });
  });
}

(async () => {
  const headers = TOKEN ? { authorization: 'Bearer ' + TOKEN } : {};
  await run('GET /health', { url: BASE + '/health', connections: CONNECTIONS, duration: DURATION });
  if (TOKEN) {
    await run('GET /api/theatres', { url: BASE + '/api/theatres', connections: CONNECTIONS, duration: DURATION, headers });
    await run('GET /api/auth/me', { url: BASE + '/api/auth/me', connections: CONNECTIONS, duration: DURATION, headers });
  }
})();
