import fs from 'node:fs';
import path from 'node:path';

const KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export class Metrics {
  constructor(file) {
    this.file = file;
    this.data = { days: {}, sessions: 0 };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed && typeof parsed === 'object') this.data = parsed;
    } catch {
      /* chưa có file thống kê */
    }
    if (!this.data.days || typeof this.data.days !== 'object') this.data.days = {};
    if (!Number.isFinite(this.data.sessions)) this.data.sessions = 0;
    this.prune();
  }

  prune() {
    const cutoff = dayKey(Date.now() - KEEP_DAYS * DAY_MS);
    for (const key of Object.keys(this.data.days)) {
      if (key < cutoff) delete this.data.days[key];
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data));
    } catch (error) {
      console.warn('[metrics] không ghi được file thống kê:', error.message);
    }
  }

  recordSession(visitorId) {
    const key = dayKey();
    if (!this.data.days[key]) this.data.days[key] = { visitors: [], sessions: 0 };
    const day = this.data.days[key];
    day.sessions += 1;
    this.data.sessions += 1;
    if (visitorId && !day.visitors.includes(visitorId)) {
      day.visitors.push(visitorId);
    }
    this.save();
  }

  today() {
    const key = dayKey();
    const day = this.data.days[key];
    return {
      date: key,
      visitors: day ? day.visitors.length : 0,
      sessions: day ? day.sessions : 0,
    };
  }

  recent(count = 7) {
    const days = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const key = dayKey(Date.now() - offset * DAY_MS);
      const day = this.data.days[key];
      days.push({
        date: key,
        visitors: day ? day.visitors.length : 0,
        sessions: day ? day.sessions : 0,
      });
    }
    return days;
  }

  totalSessions() {
    return this.data.sessions;
  }
}
