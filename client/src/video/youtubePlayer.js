let apiPromise = null;

function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });

  return apiPromise;
}

export function parseYouTubeId(input) {
  if (!input) return '';
  if (/^[\w-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input.includes('://') ? input : `https://${input}`);
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.slice(1, 12);
    }
    const direct = url.searchParams.get('v');
    if (direct) return direct.slice(0, 11);
    const parts = url.pathname.split('/');
    const marker = parts.findIndex((part) => ['embed', 'shorts', 'live'].includes(part));
    if (marker >= 0 && parts[marker + 1]) return parts[marker + 1].slice(0, 11);
  } catch {
    /* fall through */
  }
  return '';
}

export class YouTubePlayer {
  constructor(src) {
    this.kind = 'youtube';
    this.videoId = parseYouTubeId(src);
    this.volume = 80;
    this.started = false;

    this.container = document.createElement('div');
    this.container.className = 'yt-frame';

    this.startButton = document.createElement('button');
    this.startButton.type = 'button';
    this.startButton.className = 'yt-start';
    this.startButton.textContent = 'Bấm để phát phim';
    this.startButton.addEventListener('click', () => this.play());

    this.mount = document.createElement('div');
    this.container.appendChild(this.mount);
    this.container.appendChild(this.startButton);

    this.ready = this.init();
  }

  get isOverlay() {
    return true;
  }

  getOverlayElement() {
    return this.container;
  }

  getTexture() {
    return null;
  }

  async init() {
    if (!this.videoId) return;
    const YT = await loadYouTubeApi();
    return new Promise((resolve) => {
      this.player = new YT.Player(this.mount, {
        videoId: this.videoId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            event.target.setVolume(this.volume);
            resolve();
          },
          onStateChange: (event) => {
            if (event.data === 1) {
              this.started = true;
              this.startButton.style.display = 'none';
            }
          },
          onError: () => this.onError?.(),
        },
      });
    });
  }

  play() {
    if (!this.player || typeof this.player.playVideo !== 'function') return;
    this.player.playVideo();
  }

  pause() {
    if (!this.player || typeof this.player.pauseVideo !== 'function') return;
    this.player.pauseVideo();
  }

  seek(time) {
    if (!this.player || typeof this.player.seekTo !== 'function') return;
    if (!Number.isFinite(time)) return;
    this.player.seekTo(Math.max(0, time), true);
  }

  getTime() {
    if (!this.player || typeof this.player.getCurrentTime !== 'function') return 0;
    return this.player.getCurrentTime() || 0;
  }

  getDuration() {
    if (!this.player || typeof this.player.getDuration !== 'function') return 0;
    return this.player.getDuration() || 0;
  }

  isPlaying() {
    if (!this.player || typeof this.player.getPlayerState !== 'function') return false;
    return this.player.getPlayerState() === 1;
  }

  setVolume(value) {
    const volume = Math.min(1, Math.max(0, Number(value) || 0));
    this.volume = volume * 100;
    if (this.player && typeof this.player.setVolume === 'function') {
      this.player.setVolume(this.volume);
      if (volume === 0 && typeof this.player.mute === 'function') this.player.mute();
      if (volume > 0 && typeof this.player.unMute === 'function') this.player.unMute();
    }
  }

  destroy() {
    this.onError = null;
    if (this.player && typeof this.player.destroy === 'function') {
      try {
        this.player.destroy();
      } catch {
        /* ignore */
      }
    }
    this.container.remove();
  }
}
