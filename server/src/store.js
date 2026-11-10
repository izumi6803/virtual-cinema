import fs from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({
  users: [],
  theatres: [],
  sessions: {},
  moderation: [],
  reports: [],
  audit: [],
});

function normalize(data) {
  const next = { ...EMPTY(), ...(data && typeof data === 'object' ? data : {}) };
  if (!Array.isArray(next.users)) next.users = [];
  if (!Array.isArray(next.theatres)) next.theatres = [];
  if (!next.sessions || typeof next.sessions !== 'object') next.sessions = {};
  if (!Array.isArray(next.moderation)) next.moderation = [];
  if (!Array.isArray(next.reports)) next.reports = [];
  if (!Array.isArray(next.audit)) next.audit = [];
  return next;
}

export class Store {
  constructor(file) {
    this.file = file;
    this.data = EMPTY();
    this.dbDirty = false;
    this.load();
  }

  load() {
    try {
      this.data = normalize(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      this.data = EMPTY();
    }
    this.pruneSessions();
    if (this.data.moderation.length > 300) {
      this.data.moderation = this.data.moderation.slice(-300);
    }
  }

  loadData(data) {
    this.data = normalize(data);
    this.pruneSessions();
  }

  save() {
    this.dbDirty = true;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(this.data, null, 2));
      fs.renameSync(temp, this.file);
    } catch (error) {
      console.warn('[store] không ghi được dữ liệu:', error.message);
    }
  }

  pruneSessions() {
    const now = Date.now();
    for (const [hash, session] of Object.entries(this.data.sessions)) {
      if (!session || !session.expiresAt || session.expiresAt < now) {
        delete this.data.sessions[hash];
      }
    }
  }

  findUserByEmail(email) {
    const target = String(email || '').toLowerCase();
    return this.data.users.find((user) => user.email === target) || null;
  }

  findUserById(id) {
    return this.data.users.find((user) => user.id === id) || null;
  }

  addUser(user) {
    this.data.users.push(user);
    this.save();
    return user;
  }

  updateUser(id, patch) {
    const user = this.findUserById(id);
    if (!user) return null;
    Object.assign(user, patch);
    this.save();
    return user;
  }

  listUsers() {
    return [...this.data.users].sort((a, b) => b.createdAt - a.createdAt);
  }

  createSession(tokenHash, userId, expiresAt) {
    this.data.sessions[tokenHash] = { userId, expiresAt };
    this.save();
  }

  findSession(tokenHash) {
    const session = this.data.sessions[tokenHash];
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      delete this.data.sessions[tokenHash];
      this.save();
      return null;
    }
    return session;
  }

  deleteSession(tokenHash) {
    if (!this.data.sessions[tokenHash]) return;
    delete this.data.sessions[tokenHash];
    this.save();
  }

  deleteSessionsForUser(userId, exceptHash = null) {
    let changed = false;
    for (const [hash, session] of Object.entries(this.data.sessions)) {
      if (session?.userId !== userId) continue;
      if (exceptHash && hash === exceptHash) continue;
      delete this.data.sessions[hash];
      changed = true;
    }
    if (changed) this.save();
  }

  findTheatre(id) {
    return this.data.theatres.find((theatre) => theatre.id === id) || null;
  }

  addTheatre(theatre) {
    this.data.theatres.push(theatre);
    this.save();
    return theatre;
  }

  updateTheatre(id, patch) {
    const theatre = this.findTheatre(id);
    if (!theatre) return null;
    Object.assign(theatre, patch);
    this.save();
    return theatre;
  }

  deleteTheatre(id) {
    const before = this.data.theatres.length;
    this.data.theatres = this.data.theatres.filter((theatre) => theatre.id !== id);
    if (this.data.theatres.length !== before) this.save();
  }

  listTheatres() {
    return [...this.data.theatres].sort((a, b) => b.createdAt - a.createdAt);
  }

  logModeration(entry) {
    this.data.moderation.push(entry);
    if (this.data.moderation.length > 300) {
      this.data.moderation = this.data.moderation.slice(-300);
    }
    this.save();
  }
}
