export const SEAT_ROWS = 6;
export const SEAT_COLS = 10;

const SEAT_CAPACITY = SEAT_ROWS * SEAT_COLS;
const requestedRoomSize = Number(process.env.MAX_ROOM_SIZE);
const MAX_ROOM_SIZE =
  Number.isFinite(requestedRoomSize) && requestedRoomSize > 0
    ? Math.min(SEAT_CAPACITY, Math.floor(requestedRoomSize))
    : SEAT_CAPACITY;

export function seatPosition(seatId) {
  const [row, col] = String(seatId).split('-').map(Number);
  return {
    row,
    col,
    x: (col - (SEAT_COLS - 1) / 2) * 0.95,
    y: 0,
    z: 1.7 + row * 1.15,
  };
}

export function isValidSeat(seatId) {
  if (typeof seatId !== 'string' || !/^\d+-\d+$/.test(seatId)) return false;
  const { row, col } = seatPosition(seatId);
  return row >= 0 && row < SEAT_ROWS && col >= 0 && col < SEAT_COLS;
}

function clampTime(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.min(seconds, 60 * 60 * 12);
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.userRooms = new Map();
  }

  ensure(theatre) {
    const existing = this.rooms.get(theatre.id);
    if (existing) return existing;

    const now = Date.now();
    const room = {
      id: theatre.id,
      theatreId: theatre.id,
      name: theatre.name,
      ownerId: theatre.ownerId,
      hostId: null,
      moderators: Array.isArray(theatre.moderators) ? [...theatre.moderators] : [],
      createdAt: now,
      lastActive: now,
      video: {
        kind: theatre.video.kind,
        src: theatre.video.src,
        playing: false,
        baseTime: 0,
        baseAt: now,
      },
      users: new Map(),
    };
    this.rooms.set(room.id, room);
    return room;
  }

  roomOf(userId) {
    const roomId = this.userRooms.get(userId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  count(theatreId) {
    return this.rooms.get(theatreId)?.users.size || 0;
  }

  getRoom(theatreId) {
    return this.rooms.get(theatreId) || null;
  }

  reassignOwner(theatreId, ownerId) {
    const room = this.rooms.get(theatreId);
    if (!room) return;
    room.ownerId = ownerId;
    const ownerMember = [...room.users.values()].find((user) => user.accountId === ownerId);
    if (ownerMember) room.hostId = ownerMember.id;
  }

  join(theatre, user, socketId) {
    const room = this.ensure(theatre);
    if (room.users.has(socketId)) return { room };
    if (room.users.size >= MAX_ROOM_SIZE) return { error: 'Rạp đã đủ người.' };
    if (Array.isArray(theatre.bannedUsers) && theatre.bannedUsers.includes(user.id)) {
      return { error: 'Bạn đã bị cấm khỏi rạp này.' };
    }

    room.users.set(socketId, {
      id: socketId,
      accountId: user.id,
      name: user.name,
      email: user.email,
      seatId: null,
      voice: false,
      speaking: false,
      muted: false,
      joinedAt: Date.now(),
    });
    if (!room.hostId || user.id === room.ownerId || user.id === theatre.hostOverride) {
      room.hostId = socketId;
    }
    room.lastActive = Date.now();
    this.userRooms.set(socketId, room.id);
    return { room };
  }

  leave(userId) {
    const room = this.roomOf(userId);
    if (!room) return null;

    const user = room.users.get(userId);
    const name = user?.name || 'Ai đó';
    room.users.delete(userId);
    this.userRooms.delete(userId);

    if (room.users.size === 0) {
      this.rooms.delete(room.id);
      return { room, empty: true, name };
    }

    if (room.hostId === userId) {
      const owner = [...room.users.values()].find((member) => member.accountId === room.ownerId);
      room.hostId = owner ? owner.id : room.users.keys().next().value;
    }
    room.lastActive = Date.now();
    return { room, empty: false, name };
  }

  close(theatreId) {
    const room = this.rooms.get(theatreId);
    if (!room) return null;
    for (const userId of room.users.keys()) this.userRooms.delete(userId);
    this.rooms.delete(theatreId);
    return room;
  }

  claimSeat(userId, seatId) {
    const room = this.roomOf(userId);
    if (!room) return { error: 'Bạn chưa ở trong rạp.' };
    if (!isValidSeat(seatId)) return { error: 'Ghế này không tồn tại.' };

    const taken = [...room.users.values()].find(
      (user) => user.seatId === seatId && user.id !== userId,
    );
    if (taken) return { error: 'Ghế đã có người ngồi.' };

    room.users.get(userId).seatId = seatId;
    room.lastActive = Date.now();
    return { room };
  }

  controlVideo(userId, { action, time } = {}) {
    const room = this.roomOf(userId);
    if (!room) return { error: 'Bạn chưa ở trong rạp.' };
    if (room.hostId !== userId) return { error: 'Chỉ chủ phòng được điều khiển phim.' };

    const { video } = room;
    const now = Date.now();
    if (action === 'play') {
      video.playing = true;
      video.baseTime = clampTime(time);
      video.baseAt = now;
    } else if (action === 'pause') {
      video.playing = false;
      video.baseTime = clampTime(time);
      video.baseAt = now;
    } else if (action === 'seek') {
      video.baseTime = clampTime(time);
      video.baseAt = now;
    } else {
      return { error: 'Hành động không hợp lệ.' };
    }
    room.lastActive = now;
    return { room };
  }

  setVoice(userId, { active, speaking, muted } = {}) {
    const room = this.roomOf(userId);
    if (!room) return null;
    const user = room.users.get(userId);
    if (!user) return null;
    if (typeof active === 'boolean') user.voice = active;
    if (typeof speaking === 'boolean') user.speaking = speaking;
    if (typeof muted === 'boolean') user.muted = muted;
    if (active === false) {
      user.speaking = false;
      user.muted = false;
    }
    room.lastActive = Date.now();
    return room;
  }

  serialize(room) {
    return {
      id: room.id,
      theatreId: room.theatreId,
      name: room.name,
      ownerId: room.ownerId,
      hostId: room.hostId,
      moderators: room.moderators || [],
      createdAt: room.createdAt,
      serverTime: Date.now(),
      video: { ...room.video },
      users: [...room.users.values()].map((user) => ({
        id: user.id,
        accountId: user.accountId,
        name: user.name,
        seatId: user.seatId,
        voice: user.voice,
        speaking: user.speaking,
        muted: user.muted,
      })),
    };
  }

  adminSnapshot() {
    return [...this.rooms.values()].map((room) => ({
      id: room.id,
      theatreId: room.theatreId,
      name: room.name,
      ownerId: room.ownerId,
      hostId: room.hostId,
      createdAt: room.createdAt,
      video: { kind: room.video.kind, playing: room.video.playing },
      users: [...room.users.values()].map((user) => ({
        id: user.id,
        accountId: user.accountId,
        name: user.name,
        email: user.email,
        seatId: user.seatId,
        voice: user.voice,
        speaking: user.speaking,
        muted: user.muted,
        joinedAt: user.joinedAt,
      })),
    }));
  }

  sweep(maxIdleMs = 1000 * 60 * 60 * 6) {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (now - room.lastActive <= maxIdleMs) continue;
      for (const userId of room.users.keys()) this.userRooms.delete(userId);
      this.rooms.delete(id);
    }
  }
}
