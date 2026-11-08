const BASE = process.env.BASE_URL || 'http://localhost:3001';

async function post(path, body, token) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

(async () => {
  const email = `loadtest${Date.now()}@test.local`;
  const reg = await post('/api/auth/register', { name: 'Load Test', email, password: 'loadtest-123' });
  if (reg.status !== 201) throw new Error('register failed: ' + reg.status + ' ' + JSON.stringify(reg.body));
  const token = reg.body.token;

  const th = await post('/api/theatres', {
    name: 'Load Test Room',
    description: 'synthetic load test',
    video: { kind: 'html5', src: 'https://cdn.example.org/movie.mp4' },
    visibility: 'public',
  }, token);
  if (th.status !== 201 && th.status !== 200) throw new Error('theatre failed: ' + th.status + ' ' + JSON.stringify(th.body));

  console.log(JSON.stringify({ token, theatreId: th.body.theatre.id }));
})();
