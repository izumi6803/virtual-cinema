const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export class VoiceChat {
  constructor({ socket, getSpatial }) {
    this.socket = socket;
    this.getSpatial = getSpatial;
    this.ctx = null;
    this.masterGain = null;
    this.limiter = null;
    this.micStream = null;
    this.micTrack = null;
    this.localSource = null;
    this.localAnalyser = null;
    this.remoteAnalysers = new Map();
    this.audioElements = new Map();
    this.levelBuffer = null;
    this.peers = new Map();
    this.panners = new Map();
    this.connected = false;
    this.enabled = false;
    this.muted = false;
    this.onPeersChanged = null;

    this.handleSignal = this.handleSignal.bind(this);
    this.handlePeerLeft = this.handlePeerLeft.bind(this);
  }

  createContext() {
    if (this.ctx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio không được hỗ trợ');

    this.ctx = new AudioContextClass();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.2;

    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;

    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);
    this.setupListener();
    this.resume().catch(() => {});
  }

  async resume() {
    for (const audio of this.audioElements.values()) {
      if (audio.paused) audio.play().catch(() => {});
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        /* cần thêm một cú click của người dùng */
      }
    }
  }

  setupListener() {
    const listener = this.ctx.listener;
    if (listener.positionX) {
      listener.positionX.value = 0;
      listener.positionY.value = 1.7;
      listener.positionZ.value = 6;
      listener.forwardX.value = 0;
      listener.forwardY.value = 0;
      listener.forwardZ.value = -1;
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    } else if (listener.setPosition) {
      listener.setPosition(0, 1.7, 6);
      listener.setOrientation(0, 0, -1, 0, 1, 0);
    }
  }

  async startListening() {
    if (this.connected) return;
    this.createContext();
    this.connected = true;
    this.socket.on('voice:signal', this.handleSignal);
    this.socket.on('voice:peer-left', this.handlePeerLeft);

    await new Promise((resolve) => {
      this.socket.timeout(5000).emit('voice:join', { speaking: false }, (error, response) => {
        if (!error && response?.ok) {
          for (const peerId of response.peers || []) {
            this.createOffer(peerId).catch(() => {});
          }
        }
        resolve();
      });
    });
  }

  async enableMic() {
    await this.resume();
    await this.startListening();
    await this.resume();

    if (!this.micTrack) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('Không có track micro');

      this.micStream = stream;
      this.micTrack = track;
      this.localSource = this.ctx.createMediaStreamSource(stream);
      this.localAnalyser = this.ctx.createAnalyser();
      this.localAnalyser.fftSize = 1024;
      this.localSource.connect(this.localAnalyser);
    }

    this.micTrack.enabled = !this.muted;
    this.enabled = true;
    this.rebuildPeers();
    this.socket.emit('voice:speaking', { speaking: true });
  }

  disableMic() {
    for (const track of this.micStream?.getTracks() || []) track.stop();
    if (this.localSource) {
      try {
        this.localSource.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.micStream = null;
    this.micTrack = null;
    this.localSource = null;
    this.localAnalyser = null;
    this.enabled = false;
    this.rebuildPeers();
    if (this.connected) this.socket.emit('voice:speaking', { speaking: false });
  }

  rebuildPeers() {
    const peerIds = [...this.peers.keys()];
    if (peerIds.length === 0) return;
    for (const peerId of peerIds) this.removePeer(peerId);
    for (const peerId of peerIds) {
      this.createOffer(peerId).catch(() => {});
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.micTrack) this.micTrack.enabled = !muted;
    if (this.connected && this.enabled) {
      this.socket.emit('voice:mute', { muted });
      this.socket.emit('voice:speaking', { speaking: !muted });
    }
  }

  signal(to, data) {
    this.socket.emit('voice:signal', { to, data });
  }

  createPeer(peerId) {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peer.pendingIce = [];
    peer.polite = String(this.socket.id) < String(peerId);

    peer.onicecandidate = (event) => {
      if (event.candidate) this.signal(peerId, { candidate: event.candidate });
    };
    peer.ontrack = (event) => {
      if (event.streams[0]) this.attachRemote(peerId, event.streams[0]);
    };
    peer.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(peer.connectionState)) this.removePeer(peerId);
    };

    if (this.micTrack && this.micStream) {
      peer.addTrack(this.micTrack, this.micStream);
    } else {
      peer.addTransceiver('audio', { direction: 'recvonly' });
    }

    this.peers.set(peerId, peer);
    return peer;
  }

  async createOffer(peerId) {
    const peer = this.createPeer(peerId);
    if (peer.signalingState !== 'stable') return;
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    this.signal(peerId, { sdp: peer.localDescription });
  }

  async handleSignal({ from, data }) {
    if (!from || !data) return;
    try {
      if (data.sdp) {
        let peer = this.peers.get(from);

        if (data.sdp.type === 'offer') {
          if (!peer) peer = this.createPeer(from);
          const collision = peer.signalingState !== 'stable';
          if (collision) {
            if (!peer.polite) return;
            await peer.setLocalDescription({ type: 'rollback' });
          }
          await peer.setRemoteDescription(data.sdp);
          await this.flushIce(peer);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          this.signal(from, { sdp: peer.localDescription });
          return;
        }

        if (peer) {
          await peer.setRemoteDescription(data.sdp);
          await this.flushIce(peer);
        }
        return;
      }

      if (data.candidate) {
        const peer = this.peers.get(from);
        if (!peer) return;
        if (peer.remoteDescription?.type) await peer.addIceCandidate(data.candidate);
        else peer.pendingIce.push(data.candidate);
      }
    } catch (error) {
      console.warn('[voice] không xử lý được tín hiệu', error);
    }
  }

  async flushIce(peer) {
    const pending = peer.pendingIce || [];
    peer.pendingIce = [];
    for (const candidate of pending) {
      try {
        await peer.addIceCandidate(candidate);
      } catch {
        /* ứng viên có thể đã lỗi thời */
      }
    }
  }

  attachRemote(peerId, stream) {
    if (!this.ctx) return;

    const existing = this.panners.get(peerId);
    if (existing) {
      try {
        existing.source.disconnect();
        existing.panner.disconnect();
        existing.analyser.disconnect();
        existing.dry.disconnect();
      } catch {
        /* ignore */
      }
    }

    const source = this.ctx.createMediaStreamSource(stream);
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 2.5;
    panner.maxDistance = 60;
    panner.rolloffFactor = 0.7;

    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;

    const dry = this.ctx.createGain();
    dry.gain.value = 0.3;

    source.connect(panner);
    source.connect(analyser);
    source.connect(dry);
    panner.connect(this.masterGain);
    dry.connect(this.masterGain);

    let audio = this.audioElements.get(peerId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.className = 'peer-audio';
      audio.autoplay = true;
      audio.playsInline = true;
      audio.volume = 0.005;
      document.body.appendChild(audio);
      this.audioElements.set(peerId, audio);
    }
    audio.srcObject = stream;
    audio.play().catch(() => {
      /* thử lại trong resume() sau cú click tiếp theo */
    });

    this.panners.set(peerId, { source, panner, analyser, dry, audio });
    this.remoteAnalysers.set(peerId, analyser);
    this.onPeersChanged?.(this.panners.size);
  }

  handlePeerLeft({ id }) {
    this.removePeer(id);
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      try {
        peer.close();
      } catch {
        /* ignore */
      }
      this.peers.delete(peerId);
    }

    const entry = this.panners.get(peerId);
    if (entry) {
      try {
        entry.source.disconnect();
        entry.panner.disconnect();
        entry.analyser.disconnect();
        entry.dry.disconnect();
      } catch {
        /* ignore */
      }
      entry.audio?.remove();
      this.audioElements.delete(peerId);
      this.panners.delete(peerId);
      this.remoteAnalysers.delete(peerId);
      this.onPeersChanged?.(this.panners.size);
    }
  }

  readLevel(analyser) {
    if (!analyser) return 0;
    if (!this.levelBuffer || this.levelBuffer.length !== analyser.fftSize) {
      this.levelBuffer = new Float32Array(analyser.fftSize);
    }
    analyser.getFloatTimeDomainData(this.levelBuffer);
    let sum = 0;
    for (let i = 0; i < this.levelBuffer.length; i += 1) {
      sum += this.levelBuffer[i] * this.levelBuffer[i];
    }
    return Math.sqrt(sum / this.levelBuffer.length);
  }

  getLevels() {
    let remote = 0;
    for (const analyser of this.remoteAnalysers.values()) {
      remote = Math.max(remote, this.readLevel(analyser));
    }
    return {
      local: this.readLevel(this.localAnalyser),
      remote,
      peers: this.panners.size,
    };
  }

  isAudioBlocked() {
    return Boolean(this.ctx && this.ctx.state !== 'running');
  }

  playTestTone() {
    if (!this.ctx || !this.masterGain) return;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + 0.4);
  }

  update() {
    if (!this.ctx) return;
    const spatial = this.getSpatial?.();
    if (!spatial) return;

    const listener = this.ctx.listener;
    const position = spatial.listener.position;
    if (listener.positionX) {
      listener.positionX.value = position.x;
      listener.positionY.value = position.y;
      listener.positionZ.value = position.z;
      listener.forwardX.value = spatial.listener.forward.x;
      listener.forwardY.value = spatial.listener.forward.y;
      listener.forwardZ.value = spatial.listener.forward.z;
      listener.upX.value = spatial.listener.up.x;
      listener.upY.value = spatial.listener.up.y;
      listener.upZ.value = spatial.listener.up.z;
    } else if (listener.setPosition) {
      listener.setPosition(position.x, position.y, position.z);
      const { forward, up } = spatial.listener;
      listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }

    for (const [id, entry] of this.panners) {
      const target = spatial.positions.get(id);
      if (!target) continue;
      const { panner } = entry;
      if (panner.positionX) {
        panner.positionX.value = target.x;
        panner.positionY.value = target.y;
        panner.positionZ.value = target.z;
      } else if (panner.setPosition) {
        panner.setPosition(target.x, target.y, target.z);
      }
    }
  }

  destroy() {
    if (this.enabled) this.disableMic();
    if (this.connected) this.socket.emit('voice:leave');
    this.socket.off('voice:signal', this.handleSignal);
    this.socket.off('voice:peer-left', this.handlePeerLeft);

    for (const peerId of [...this.peers.keys()]) this.removePeer(peerId);
    for (const audio of this.audioElements.values()) audio.remove();
    this.audioElements.clear();
    for (const track of this.micStream?.getTracks() || []) track.stop();

    this.micStream = null;
    this.micTrack = null;
    this.localSource = null;
    this.localAnalyser = null;
    this.remoteAnalysers.clear();
    this.enabled = false;
    this.connected = false;
    this.muted = false;

    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.masterGain = null;
    this.limiter = null;
    this.onPeersChanged?.(0);
  }
}
