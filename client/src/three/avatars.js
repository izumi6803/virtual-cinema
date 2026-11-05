import * as THREE from 'three';
import { avatarHue } from '../lib/format.js';
import { seatPosition } from '../lib/layout.js';

function makeLabel(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.font = '600 54px Inter, system-ui, sans-serif';
  const text = name.slice(0, 18);
  const width = Math.min(480, ctx.measureText(text).width + 64);
  const left = (512 - width) / 2;

  ctx.fillStyle = 'rgba(8, 8, 14, 0.74)';
  ctx.beginPath();
  ctx.roundRect(left, 24, width, 80, 24);
  ctx.fill();

  ctx.strokeStyle = 'rgba(240, 180, 106, 0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#f4ece1';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 66);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createAvatar(user, isSelf) {
  const group = new THREE.Group();
  const hue = avatarHue(user.id) / 360;
  const color = new THREE.Color().setHSL(hue, 0.62, 0.55);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.15,
    emissive: color.clone().multiplyScalar(0.18),
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.34, 6, 12), bodyMaterial);
  body.position.y = 0.86;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 20, 16),
    new THREE.MeshStandardMaterial({ color: 0xe8c9a8, roughness: 0.65 }),
  );
  head.position.y = 1.24;
  head.castShadow = true;
  group.add(head);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.34, 32),
    new THREE.MeshBasicMaterial({
      color: isSelf ? 0xf0b46a : 0x6f8db5,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);

  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: makeLabel(user.name), transparent: true, depthWrite: false }),
  );
  label.scale.set(1.35, 0.34, 1);
  label.position.y = 1.74;
  if (isSelf) label.visible = false;
  group.add(label);

  let currentName = user.name;
  let speaking = false;
  const idleColor = isSelf ? 0xf0b46a : 0x6f8db5;
  const target = new THREE.Vector3();

  function setSeat(seatId) {
    if (seatId) {
      const position = seatPosition(seatId);
      target.set(position.x, 0.02, position.z - 0.06);
    } else {
      target.set(hue > 0.5 ? 6.3 : -6.3, 0.02, 8.8 + (hue % 0.2) * 3);
    }
  }

  function setName(next) {
    if (next === currentName) return;
    currentName = next;
    label.material.map?.dispose();
    label.material.map = makeLabel(next);
    label.material.needsUpdate = true;
  }

  function setSpeaking(next) {
    if (speaking === next) return;
    speaking = next;
    ring.material.color.setHex(next ? 0x6ee7a8 : idleColor);
    ring.material.opacity = next ? 1 : 0.6;
  }

  function dispose() {
    group.traverse((child) => {
      if (!child.isMesh && !child.isSprite) return;
      child.geometry?.dispose?.();
      const material = child.material;
      if (!material) return;
      material.map?.dispose?.();
      material.dispose?.();
    });
  }

  setSeat(user.seatId);

  return { group, target, setSeat, setName, setSpeaking, dispose };
}
