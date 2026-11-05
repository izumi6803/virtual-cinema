export const SEAT_ROWS = 6;
export const SEAT_COLS = 10;

export function parseSeat(seatId) {
  const [row, col] = String(seatId).split('-').map(Number);
  return { row, col };
}

export function seatPosition(seatId) {
  const { row, col } = parseSeat(seatId);
  return {
    row,
    col,
    x: (col - (SEAT_COLS - 1) / 2) * 0.95,
    y: 0,
    z: 1.7 + row * 1.15,
  };
}

export function seatDistance(a, b) {
  if (!a || !b) return Infinity;
  const first = seatPosition(a);
  const second = seatPosition(b);
  return Math.hypot(first.x - second.x, first.z - second.z);
}

export function seatLabel(seatId) {
  if (!seatId) return 'Chưa chọn ghế';
  const { row, col } = parseSeat(seatId);
  return `Hàng ${row + 1} · Ghế ${col + 1}`;
}
