import * as THREE from 'three';
import { SEAT_COLS, SEAT_ROWS, seatPosition } from '../lib/layout.js';

const SCREEN_WIDTH = 10.6;
const SCREEN_HEIGHT = 5.96;
const SCREEN_Z = -6.6;
const SCREEN_Y = 3.7;

const SEAT_STATES = {
  free: { color: 0x2b3346, emissive: 0x000000, intensity: 0 },
  hover: { color: 0x2b3a52, emissive: 0x3f86c4, intensity: 0.55 },
  mine: { color: 0x2a4468, emissive: 0x4d8dd8, intensity: 0.9 },
  taken: { color: 0x3a2029, emissive: 0x6d2337, intensity: 0.35 },
};

function createSeat(seatId) {
  const position = seatPosition(seatId);
  const group = new THREE.Group();
  group.position.set(position.x, 0, position.z);

  const material = new THREE.MeshStandardMaterial({
    color: SEAT_STATES.free.color,
    roughness: 0.72,
    metalness: 0.08,
    emissive: SEAT_STATES.free.emissive,
  });

  const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.16, 0.7), material);
  cushion.position.set(0, 0.48, 0);
  cushion.castShadow = true;
  cushion.receiveShadow = true;
  cushion.userData.seatId = seatId;
  group.add(cushion);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.78, 0.14), material);
  back.position.set(0, 0.88, 0.31);
  back.castShadow = true;
  back.userData.seatId = seatId;
  group.add(back);

  for (const x of [-0.44, 0.44]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.6), material);
    arm.position.set(x, 0.6, 0);
    arm.userData.seatId = seatId;
    group.add(arm);
  }

  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8), material);
  leg.position.y = 0.22;
  group.add(leg);

  let state = 'free';

  function setState(next) {
    if (state === next) return;
    state = next;
    const preset = SEAT_STATES[next] || SEAT_STATES.free;
    material.color.setHex(preset.color);
    material.emissive.setHex(preset.emissive);
    material.emissiveIntensity = preset.intensity;
  }

  return {
    group,
    setState,
    getState: () => state,
  };
}

function makeIdleScreen() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 576;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 0, 576);
  gradient.addColorStop(0, '#101a2c');
  gradient.addColorStop(0.55, '#0a1220');
  gradient.addColorStop(1, '#05070d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 576);

  const glow = ctx.createRadialGradient(512, 240, 40, 512, 240, 430);
  glow.addColorStop(0, 'rgba(143, 192, 255, 0.18)');
  glow.addColorStop(1, 'rgba(143, 192, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1024, 576);

  ctx.strokeStyle = 'rgba(240, 180, 106, 0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(438, 300);
  ctx.lineTo(586, 300);
  ctx.stroke();

  ctx.fillStyle = 'rgba(244, 236, 225, 0.46)';
  ctx.font = '500 24px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SẴN SÀNG CHIẾU', 512, 352);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addMarqueeBulbs(root) {
  const geometry = new THREE.SphereGeometry(0.05, 8, 8);
  const material = new THREE.MeshBasicMaterial({ color: 0xf0b46a, toneMapped: false });
  for (let i = 0; i < 22; i += 1) {
    const x = -5.5 + (i / 21) * 11;
    for (const y of [SCREEN_Y + SCREEN_HEIGHT / 2 + 0.16, SCREEN_Y - SCREEN_HEIGHT / 2 - 0.16]) {
      const bulb = new THREE.Mesh(geometry, material);
      bulb.position.set(x, y, SCREEN_Z + 0.12);
      root.add(bulb);
    }
  }
}

export function buildRoom(scene) {
  const root = new THREE.Group();
  scene.add(root);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(17, 26),
    new THREE.MeshStandardMaterial({ color: 0x140b12, roughness: 0.96, metalness: 0.02 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = 4;
  floor.receiveShadow = true;
  root.add(floor);

  const carpetMaterial = new THREE.MeshStandardMaterial({ color: 0x2b0f19, roughness: 1 });
  for (const x of [-6.4, 6.4]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 24), carpetMaterial);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(x, 0.006, 3.5);
    root.add(strip);
  }

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 0.92 });
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(17, 7.5, 0.4), wallMaterial);
  backWall.position.set(0, 3.75, 16.2);
  root.add(backWall);

  for (const x of [-8.5, 8.5]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7.5, 26), wallMaterial);
    wall.position.set(x, 3.75, 4);
    root.add(wall);
  }

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(17, 26),
    new THREE.MeshStandardMaterial({ color: 0x05040a, roughness: 1 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, 7.5, 4);
  root.add(ceiling);

  const starGeometry = new THREE.BufferGeometry();
  const starCount = 240;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    starPositions[i * 3] = (Math.random() - 0.5) * 16;
    starPositions[i * 3 + 1] = 7.44;
    starPositions[i * 3 + 2] = -6 + Math.random() * 22;
  }
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
      color: 0x9fc4ff,
      size: 0.05,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    }),
  );
  root.add(stars);

  const idleTexture = makeIdleScreen();
  const screenMaterial = new THREE.MeshBasicMaterial({ map: idleTexture, toneMapped: false });
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(SCREEN_WIDTH, SCREEN_HEIGHT),
    screenMaterial,
  );
  screen.position.set(0, SCREEN_Y, SCREEN_Z);
  root.add(screen);

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x151a26,
    roughness: 0.5,
    metalness: 0.4,
    emissive: 0x14243a,
    emissiveIntensity: 0.8,
  });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(11.3, 6.66, 0.3), frameMaterial);
  frame.position.set(0, SCREEN_Y, SCREEN_Z - 0.18);
  root.add(frame);

  const curtainMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a0a14,
    roughness: 1,
    emissive: 0x12040a,
    emissiveIntensity: 0.6,
  });
  for (const x of [-6.9, 6.9]) {
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 7.2), curtainMaterial);
    curtain.position.set(x, 3.4, SCREEN_Z + 0.2);
    root.add(curtain);
  }

  addMarqueeBulbs(root);

  const exitMaterial = new THREE.MeshBasicMaterial({ color: 0x24d18a, toneMapped: false });
  for (const x of [-8.28, 8.28]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.2), exitMaterial);
    sign.position.set(x, 3.2, 13.8);
    sign.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    root.add(sign);
  }

  root.add(new THREE.AmbientLight(0x44506e, 0.9));
  root.add(new THREE.HemisphereLight(0x2a3a58, 0x1c0a10, 0.8));

  const screenGlow = new THREE.PointLight(0x6fa8ff, 90, 26, 2);
  screenGlow.position.set(0, 3.2, -5);
  root.add(screenGlow);

  for (const x of [-6.8, 6.8]) {
    const aisleLight = new THREE.PointLight(0xff9d5c, 22, 16, 2);
    aisleLight.position.set(x, 4.4, 8);
    root.add(aisleLight);
  }

  const houseLight = new THREE.SpotLight(0xffcf9a, 170, 28, 1, 1, 2);
  houseLight.position.set(0, 7.2, 6.5);
  houseLight.target.position.set(0, 0, 4);
  houseLight.castShadow = true;
  houseLight.shadow.mapSize.set(1024, 1024);
  houseLight.shadow.bias = -0.0006;
  root.add(houseLight);
  root.add(houseLight.target);

  const rim = new THREE.PointLight(0xff7a4d, 30, 18, 2);
  rim.position.set(0, 2.4, 14.8);
  root.add(rim);

  const seats = new Map();
  const seatTargets = [];
  for (let row = 0; row < SEAT_ROWS; row += 1) {
    for (let col = 0; col < SEAT_COLS; col += 1) {
      const seatId = `${row}-${col}`;
      const seat = createSeat(seatId);
      root.add(seat.group);
      seats.set(seatId, seat);
      seat.group.traverse((child) => {
        if (child.isMesh && child.userData.seatId) seatTargets.push(child);
      });
    }
  }

  return {
    group: root,
    screen,
    screenMaterial,
    idleTexture,
    screenSize: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
    seats,
    seatTargets,
  };
}
