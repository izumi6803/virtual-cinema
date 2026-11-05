import * as THREE from 'three';

export class Html5Player {
  constructor(src) {
    this.kind = 'html5';
    this.volume = 0.8;

    this.video = document.createElement('video');
    this.video.crossOrigin = 'anonymous';
    this.video.preload = 'auto';
    this.video.playsInline = true;
    this.video.src = src;
    this.video.className = 'media-hidden';
    this.video.volume = this.volume;
    this.video.addEventListener('error', () => this.onError?.());
    document.body.appendChild(this.video);

    this.texture = new THREE.VideoTexture(this.video);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    this.ready = new Promise((resolve) => {
      if (this.video.readyState >= 1) {
        resolve();
        return;
      }
      this.video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
  }

  get isOverlay() {
    return false;
  }

  getOverlayElement() {
    return null;
  }

  getTexture() {
    return this.texture;
  }

  play() {
    const attempt = this.video.play();
    if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
  }

  pause() {
    this.video.pause();
  }

  seek(time) {
    if (!Number.isFinite(time)) return;
    try {
      this.video.currentTime = Math.max(0, time);
    } catch {
      /* seeking before metadata is harmless */
    }
  }

  getTime() {
    return Number.isFinite(this.video.currentTime) ? this.video.currentTime : 0;
  }

  getDuration() {
    return Number.isFinite(this.video.duration) ? this.video.duration : 0;
  }

  isPlaying() {
    return !this.video.paused && !this.video.ended;
  }

  setVolume(value) {
    const volume = Math.min(1, Math.max(0, Number(value) || 0));
    this.volume = volume;
    this.video.volume = volume;
    this.video.muted = volume === 0;
  }

  destroy() {
    this.onError = null;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
    this.texture.dispose();
  }
}
