/**
 * AudioManager.js -- placeholder audio, real architecture (spec 45).
 *
 * Sounds are synthesised with the WebAudio API so the game ships without
 * binary assets; every cue goes through `play(id)`, so swapping in recorded
 * samples later is a change to ONE method.  Browsers require a user gesture
 * before audio can start, which `unlock()` handles.
 */
const VOICES = {
  shoot: { type: 'square', frequency: 620, duration: 0.05, gain: 0.05, sweep: -180 },
  hit: { type: 'triangle', frequency: 240, duration: 0.08, gain: 0.06, sweep: -120 },
  gate: { type: 'sine', frequency: 480, duration: 0.22, gain: 0.14, sweep: 260 },
  gain: { type: 'sine', frequency: 700, duration: 0.18, gain: 0.15, sweep: 320 },
  loss: { type: 'sawtooth', frequency: 220, duration: 0.2, gain: 0.13, sweep: -140 },
  upgrade: { type: 'sine', frequency: 540, duration: 0.3, gain: 0.16, sweep: 520 },
  boss: { type: 'sawtooth', frequency: 90, duration: 0.9, gain: 0.14, sweep: 40 },
  victory: { type: 'sine', frequency: 660, duration: 0.5, gain: 0.16, sweep: 440 },
  death: { type: 'sawtooth', frequency: 320, duration: 0.7, gain: 0.18, sweep: -260 },
  continue: { type: 'sine', frequency: 420, duration: 0.4, gain: 0.16, sweep: 380 },
  ui: { type: 'square', frequency: 380, duration: 0.06, gain: 0.08, sweep: 120 }
};

export class AudioManager {
  constructor () {
    this.context = null;
    this.master = null;
    this.enabled = true;
    this.ambienceNode = null;
    this._lastPlay = new Map();
  }

  unlock () {
    if (this.context) {
      if (this.context.state === 'suspended') this.context.resume();
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    try {
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.context.destination);
    } catch (error) {
      console.warn('AudioManager: unavailable', error);
      this.context = null;
    }
  }

  setEnabled (enabled) {
    this.enabled = enabled;
    if (this.master) this.master.gain.value = enabled ? 0.5 : 0;
  }

  play (id, { rate = 1, throttleMs = 0 } = {}) {
    if (!this.enabled || !this.context) return;
    const voice = VOICES[id];
    if (!voice) return;

    // Rapid-fire cues (shooting) are throttled so they stay a texture.
    const now = this.context.currentTime;
    const last = this._lastPlay.get(id) || -1;
    const minGap = throttleMs ? throttleMs / 1000 : 0.035;
    if (now - last < minGap) return;
    this._lastPlay.set(id, now);

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = voice.type;
    oscillator.frequency.setValueAtTime(voice.frequency * rate, now);
    if (voice.sweep) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(40, (voice.frequency + voice.sweep) * rate), now + voice.duration
      );
    }
    gain.gain.setValueAtTime(voice.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + voice.duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + voice.duration + 0.02);
  }

  /** Low rumble under the run; started once audio is unlocked. */
  startAmbience () {
    if (!this.context || this.ambienceNode) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 58;
    gain.gain.value = 0.035;
    oscillator.connect(gain).connect(this.master);
    oscillator.start();
    this.ambienceNode = { oscillator, gain };
  }

  stopAmbience () {
    if (!this.ambienceNode) return;
    this.ambienceNode.oscillator.stop();
    this.ambienceNode = null;
  }
}
