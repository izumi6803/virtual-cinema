let offset = 0;

export function serverNow() {
  return Date.now() + offset;
}

export function effectiveTime(video) {
  if (!video) return 0;
  if (!video.playing) return video.baseTime || 0;
  return (video.baseTime || 0) + (serverNow() - video.baseAt) / 1000;
}

export function syncClock(socket, samples = 5) {
  return new Promise((resolve) => {
    let best = null;
    let remaining = samples;

    const finish = () => {
      remaining -= 1;
      if (remaining > 0) {
        ping();
        return;
      }
      if (best) offset = best.offset;
      resolve(offset);
    };

    const ping = () => {
      const started = Date.now();
      socket.timeout(1500).emit('time:sync', started, (error, response) => {
        if (!error && response && typeof response.serverTime === 'number') {
          const rtt = Date.now() - started;
          const candidate = response.serverTime + rtt / 2 - Date.now();
          if (!best || rtt < best.rtt) best = { rtt, offset: candidate };
        }
        finish();
      });
    };

    ping();
  });
}
