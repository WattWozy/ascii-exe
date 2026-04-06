/**
 * AudioManager — synthesized sound effects (Web Audio API) + TTS (Web Speech API).
 * No external files or API keys required.
 */
class AudioManager {
  constructor() {
    this._ctx = null;
    this._muted = false;
    this._speechMuted = false;
    this._englishVoice = null;

    // Load English voice once voices are available
    const loadVoice = () => {
      const voices = speechSynthesis.getVoices();
      this._englishVoice =
        voices.find(v => v.lang === 'en-US') ||
        voices.find(v => v.lang.startsWith('en')) ||
        null;
    };
    speechSynthesis.addEventListener('voiceschanged', loadVoice);
    loadVoice(); // In case voices are already loaded

    // Resume AudioContext on first user interaction (browser autoplay policy)
    const resume = () => {
      if (this._ctx && this._ctx.state === 'suspended') this._ctx.resume();
      document.removeEventListener('keydown', resume);
      document.removeEventListener('click', resume);
    };
    document.addEventListener('keydown', resume);
    document.addEventListener('click', resume);
  }

  _getCtx() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this._ctx;
  }

  /**
   * Play a named synthesized sound effect.
   * @param {string} name
   */
  playSound(name) {
    if (this._muted) return;
    try {
      const sounds = {
        playerDied:     () => this._tone([{ f: 440, t: 0.00 }, { f: 220, t: 0.15 }, { f: 110, t: 0.30 }], 'sawtooth', 0.18, 0.5),
        gameOverWin:    () => this._arpeggio([523, 659, 784, 1046], 'sine', 0.20, 0.12),
        gameOverLose:   () => this._tone([{ f: 300, t: 0.00 }, { f: 200, t: 0.20 }, { f: 100, t: 0.40 }], 'sine', 0.20, 0.6),
        gameStarted:    () => this._arpeggio([330, 440, 550, 660], 'square', 0.15, 0.10),
        playerJoined:   () => this._beep(880, 'sine', 0.12, 0.15),
        playerLeft:     () => this._beep(440, 'sine', 0.10, 0.15),
        serverWarning:  () => this._pulse(660, 3, 0.15),
        serverActive:   () => this._beep(780, 'square', 0.14, 0.20),
        bombPlace:      () => this._beep(200, 'square', 0.12, 0.08),
        bombExplosion:  () => this._explosion(),
        alienGrowl:     () => this._growl(),
        alienDeath:     () => this._alienDeath(),
        coinPickup:     () => this._arpeggio([1046, 1318], 'sine', 0.18, 0.07),
        dropletPickup:  () => this._droplet(),
      };

      if (sounds[name]) sounds[name]();
    } catch (e) {
      console.warn('[AudioManager] playSound error:', e);
    }
  }

  /**
   * Speak a line of text using the Web Speech API in English.
   * @param {string} text
   */
  speak(text) {
    if (this._speechMuted || !window.speechSynthesis) return;
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    if (this._englishVoice) utter.voice = this._englishVoice;
    utter.rate = 1.1;
    utter.pitch = 1.0;
    utter.volume = 0.9;
    speechSynthesis.speak(utter);
  }

  /** Play a sound and speak text together. */
  announce(soundName, text) {
    this.playSound(soundName);
    if (text) this.speak(text);
  }

  toggleMute() {
    this._muted = !this._muted;
    return this._muted;
  }

  toggleSpeech() {
    this._speechMuted = !this._speechMuted;
    if (this._speechMuted) speechSynthesis.cancel();
    return this._speechMuted;
  }

  // ── Primitive synthesizers ──────────────────────────────────────────────────

  /** Single tone with frequency envelope. nodes: [{f, t}], type, gain, duration */
  _tone(nodes, type, gain, duration) {
    const ctx = this._getCtx();
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();

    osc.type = type;
    osc.connect(vol);
    vol.connect(ctx.destination);

    const now = ctx.currentTime;
    nodes.forEach(({ f, t }) => osc.frequency.linearRampToValueAtTime(f, now + t));
    vol.gain.setValueAtTime(gain, now);
    vol.gain.linearRampToValueAtTime(0, now + duration);

    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  /** Short single-frequency beep. */
  _beep(freq, type, gain, duration) {
    this._tone([{ f: freq, t: 0 }], type, gain, duration);
  }

  /** Ascending/descending arpeggio. */
  _arpeggio(freqs, type, gain, noteLen) {
    const ctx = this._getCtx();
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = type;
      osc.frequency.value = f;
      osc.connect(vol);
      vol.connect(ctx.destination);
      const start = ctx.currentTime + i * noteLen;
      vol.gain.setValueAtTime(gain, start);
      vol.gain.linearRampToValueAtTime(0, start + noteLen);
      osc.start(start);
      osc.stop(start + noteLen + 0.05);
    });
  }

  /** Repeating pulse (e.g. alarm). */
  _pulse(freq, count, gain) {
    const ctx = this._getCtx();
    for (let i = 0; i < count; i++) {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      osc.connect(vol);
      vol.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.25;
      vol.gain.setValueAtTime(gain, start);
      vol.gain.linearRampToValueAtTime(0, start + 0.15);
      osc.start(start);
      osc.stop(start + 0.20);
    }
  }

  /** Explosion: white noise burst with low-pass filter and fast decay. */
  _explosion() {
    const ctx = this._getCtx();
    const duration = 0.8;
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Low-pass filter for a "thud" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + duration);

    const vol = ctx.createGain();
    vol.gain.setValueAtTime(1.0, ctx.currentTime);
    vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    source.connect(filter);
    filter.connect(vol);
    vol.connect(ctx.destination);
    source.start(ctx.currentTime);
    source.stop(ctx.currentTime + duration);
  }

  /** Alien death: distorted screech that cuts off abruptly. */
  _alienDeath() {
    const ctx = this._getCtx();
    const now = ctx.currentTime;
    const duration = 0.35;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.linearRampToValueAtTime(80, now + duration);

    // LFO for that dying screech wobble
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.setValueAtTime(40, now);
    lfo.frequency.linearRampToValueAtTime(5, now + duration);
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 80;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const vol = ctx.createGain();
    vol.gain.setValueAtTime(0.35, now);
    vol.gain.setValueAtTime(0.35, now + duration - 0.03);
    vol.gain.linearRampToValueAtTime(0, now + duration); // abrupt cutoff

    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.start(now);
    lfo.start(now);
    osc.stop(now + duration);
    lfo.stop(now + duration);
  }

  /** Water droplet: sine with fast pitch drop and short decay. */
  _droplet() {
    const ctx = this._getCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.12);

    const vol = ctx.createGain();
    vol.gain.setValueAtTime(0.22, now);
    vol.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.20);
  }

  /** Alien growl: low sawtooth with LFO tremolo and pitch drop. */
  _growl() {
    const ctx = this._getCtx();
    const now = ctx.currentTime;
    const duration = 0.6;

    // Main growl oscillator
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.linearRampToValueAtTime(60, now + duration);

    // LFO for tremolo effect
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 18;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 30;

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    // Distortion via waveshaper
    const distortion = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      curve[i] = (Math.PI + 200) * x / (Math.PI + 200 * Math.abs(x));
    }
    distortion.curve = curve;

    const vol = ctx.createGain();
    vol.gain.setValueAtTime(0.4, now);
    vol.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(distortion);
    distortion.connect(vol);
    vol.connect(ctx.destination);

    osc.start(now);
    lfo.start(now);
    osc.stop(now + duration);
    lfo.stop(now + duration);
  }
}

window.AudioManager = AudioManager;
