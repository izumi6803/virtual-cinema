import * as THREE from 'three';
import { seatPosition } from '../lib/layout.js';
import { buildRoom } from './buildRoom.js';
import { createAvatar } from './avatars.js';

export class CinemaScene {
  constructor(canvas, handlers = {}) {
    this.canvas = canvas;
    this.handlers = handlers;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07070c);
    this.scene.fog = new THREE.FogExp2(0x07070c, 0.022);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
    this.cameraTarget = new THREE.Vector3(0, 3.6, 13);
    this.lookTarget = new THREE.Vector3(0, 3.2, -6.6);
    this.camera.position.copy(this.cameraTarget);
    this.camera.lookAt(this.lookTarget);

    this.room = buildRoom(this.scene);
    this.screenSize = this.room.screenSize;

    this.avatars = new Map();
    this.occupancy = new Map();
    this.localId = null;
    this.localSeat = null;
    this.hoveredSeat = null;
    this.overlay = null;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.clock = new THREE.Clock();
    this.projectVector = new THREE.Vector3();

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement || canvas);
    this.resize();

    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  resize() {
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth || window.innerWidth;
    const height = parent?.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  setScreenTexture(texture) {
    const material = this.room.screenMaterial;
    material.map = texture || this.room.idleTexture;
    material.needsUpdate = true;
  }

  setOverlay(element) {
    if (this.overlay === element) return;
    if (this.overlay) {
      this.overlay.style.width = '0px';
      this.overlay.style.height = '0px';
      this.overlay.style.opacity = '0';
      this.overlay.classList.remove('screen-overlay');
    }
    this.overlay = element;
    if (this.overlay) this.overlay.classList.add('screen-overlay');
  }

  seatState(seatId) {
    const occupant = this.occupancy.get(seatId);
    if (!occupant) return 'free';
    return occupant === this.localId ? 'mine' : 'taken';
  }

  setRoomState(room, localId) {
    if (!room) return;
    const previousSeat = this.localSeat;
    const occupancy = new Map();
    let nextLocalSeat = null;

    for (const user of room.users) {
      if (user.seatId) occupancy.set(user.seatId, user.id);
      if (user.id === localId) nextLocalSeat = user.seatId;
    }

    this.occupancy = occupancy;
    this.localId = localId;
    this.localSeat = nextLocalSeat;

    for (const [seatId, seat] of this.room.seats) {
      if (occupancy.has(seatId)) seat.setState(this.seatState(seatId));
      else if (seatId === this.hoveredSeat) seat.setState('hover');
      else seat.setState('free');
    }

    const seen = new Set();
    for (const user of room.users) {
      if (user.id === localId && !user.seatId) continue;
      seen.add(user.id);
      let avatar = this.avatars.get(user.id);
      if (!avatar) {
        avatar = createAvatar(user, user.id === localId);
        avatar.group.position.copy(avatar.target);
        this.scene.add(avatar.group);
        this.avatars.set(user.id, avatar);
      }
      avatar.setSeat(user.seatId);
      avatar.setName(user.name);
      avatar.setSpeaking(Boolean(user.speaking));
    }

    for (const [id, avatar] of this.avatars) {
      if (seen.has(id)) continue;
      this.scene.remove(avatar.group);
      avatar.dispose();
      this.avatars.delete(id);
    }

    if (nextLocalSeat && nextLocalSeat !== previousSeat) {
      this.focusSeat(nextLocalSeat);
    } else if (!nextLocalSeat && previousSeat) {
      this.focusLobby();
    }
  }

  focusSeat(seatId) {
    const position = seatPosition(seatId);
    this.cameraTarget.set(position.x * 0.72, 2.95, position.z + 3.5);
  }

  focusLobby() {
    this.cameraTarget.set(0, 3.6, 13);
  }

  pickSeat(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.room.seatTargets, false);
    return hits.length ? hits[0].object.userData.seatId : null;
  }

  handlePointerDown(event) {
    if (event.button !== 0) return;
    const seatId = this.pickSeat(event);
    if (!seatId) return;
    if (this.seatState(seatId) !== 'free') return;
    this.handlers.onSeatClick?.(seatId);
  }

  handlePointerMove(event) {
    const seatId = this.pickSeat(event);
    if (seatId === this.hoveredSeat) return;

    if (this.hoveredSeat) {
      const previous = this.room.seats.get(this.hoveredSeat);
      if (previous && !this.occupancy.has(this.hoveredSeat)) previous.setState('free');
    }

    this.hoveredSeat = seatId;

    if (seatId) {
      const isFree = this.seatState(seatId) === 'free';
      if (isFree) this.room.seats.get(seatId)?.setState('hover');
      this.canvas.style.cursor = isFree ? 'pointer' : 'default';
    } else {
      this.canvas.style.cursor = 'default';
    }
  }

  handlePointerLeave() {
    if (this.hoveredSeat && !this.occupancy.has(this.hoveredSeat)) {
      this.room.seats.get(this.hoveredSeat)?.setState('free');
    }
    this.hoveredSeat = null;
    this.canvas.style.cursor = 'default';
  }

  updateOverlay() {
    if (!this.overlay) return;

    const mesh = this.room.screen;
    mesh.updateWorldMatrix(true, false);
    const { width, height } = this.screenSize;
    const corners = [
      [-width / 2, height / 2],
      [width / 2, height / 2],
      [width / 2, -height / 2],
      [-width / 2, -height / 2],
    ];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const [x, y] of corners) {
      this.projectVector
        .set(x, y, 0.02)
        .applyMatrix4(mesh.matrixWorld)
        .project(this.camera);
      const screenX = this.projectVector.x * 0.5 + 0.5;
      const screenY = -this.projectVector.y * 0.5 + 0.5;
      if (screenX < minX) minX = screenX;
      if (screenX > maxX) maxX = screenX;
      if (screenY < minY) minY = screenY;
      if (screenY > maxY) maxY = screenY;
    }

    const stageWidth = this.canvas.clientWidth;
    const stageHeight = this.canvas.clientHeight;
    const visible = maxX > 0 && minX < 1 && maxY > 0 && minY < 1;

    if (!visible) {
      this.overlay.style.opacity = '0';
      return;
    }

    this.overlay.style.opacity = '1';
    this.overlay.style.transform = `translate(${minX * stageWidth}px, ${minY * stageHeight}px)`;
    this.overlay.style.width = `${(maxX - minX) * stageWidth}px`;
    this.overlay.style.height = `${(maxY - minY) * stageHeight}px`;
  }

  getSpatial() {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const positions = new Map();
    for (const [id, avatar] of this.avatars) {
      positions.set(id, avatar.group.position);
    }
    return {
      listener: { position: this.camera.position, forward, up },
      positions,
    };
  }

  frame() {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const damping = 1 - Math.pow(0.0016, delta);

    this.camera.position.lerp(this.cameraTarget, damping);
    this.camera.lookAt(this.lookTarget);

    for (const avatar of this.avatars.values()) {
      avatar.group.position.lerp(avatar.target, Math.min(1, delta * 6));
    }

    this.updateOverlay();
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);

    for (const avatar of this.avatars.values()) {
      this.scene.remove(avatar.group);
      avatar.dispose();
    }
    this.avatars.clear();

    this.room.idleTexture?.dispose();

    this.scene.traverse((object) => {
      if (!object.isMesh && !object.isPoints) return;
      object.geometry?.dispose?.();
      const material = object.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose?.());
      else material?.dispose?.();
    });

    this.renderer.dispose();
  }
}
