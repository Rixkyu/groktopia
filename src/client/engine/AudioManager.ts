export type SoundEffect =
  | 'punch'
  | 'rock_hit'
  | 'break'
  | 'place'
  | 'seed'
  | 'harvest'
  | 'splice'
  | 'gem'
  | 'pickup'
  | 'jump'
  | 'wing'
  | 'hurt'
  | 'bumper'
  | 'warp'
  | 'lock'
  | 'ui';

export class AudioManager {
  private ctx: AudioContext | null = null;
  public sfxVolume = 0.65;
  public musicEnabled = false;
  private musicTimer: number | null = null;
  private melodyStep = 0;
  private soundBuffers = new Map<SoundEffect, AudioBuffer>();
  private audioLoadingStarted = false;

  private readonly SOUND_FILE_MAP: Partial<Record<SoundEffect, string>> = {
    punch: '/assets/gt/audio/punch.wav',
    jump: '/assets/gt/audio/jump.wav',
    rock_hit: '/assets/gt/audio/hit.wav',
    break: '/assets/gt/audio/splat.wav',
    warp: '/assets/gt/audio/teleport.wav',
    ui: '/assets/gt/audio/click.wav',
  };

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (this.ctx && !this.audioLoadingStarted) {
      this.preloadAudioBuffers(this.ctx);
    }
    return this.ctx;
  }

  private preloadAudioBuffers(ctx: AudioContext): void {
    this.audioLoadingStarted = true;
    for (const [sfx, url] of Object.entries(this.SOUND_FILE_MAP) as Array<[SoundEffect, string]>) {
      fetch(url)
        .then((res) => (res.ok ? res.arrayBuffer() : null))
        .then((buf) => (buf ? ctx.decodeAudioData(buf) : null))
        .then((audioBuf) => {
          if (audioBuf) this.soundBuffers.set(sfx, audioBuf);
        })
        .catch(() => {});
    }
  }

  public unlock(): void {
    this.ensureContext();
  }

  public setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (enabled) {
      this.startMusicLoop();
    } else if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private startMusicLoop(): void {
    if (this.musicTimer !== null) return;
    const notes = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 349.23, 440.0, 392.0];
    this.musicTimer = window.setInterval(() => {
      if (!this.musicEnabled || this.sfxVolume <= 0.01) return;
      const ctx = this.ensureContext();
      if (!ctx) return;
      const freq = notes[this.melodyStep % notes.length];
      this.melodyStep++;
      this.tone(ctx, 'triangle', freq, freq, 0.22, 0.05 * this.sfxVolume);
    }, 320);
  }

  private tone(
    ctx: AudioContext,
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    duration: number,
    gainVal: number,
    delay = 0
  ): void {
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, t0);
    if (startFreq !== endFreq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + duration);
    }
    gain.gain.setValueAtTime(Math.max(0.001, gainVal), t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.01);
  }

  public play(sfx: SoundEffect): void {
    if (this.sfxVolume <= 0.01) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const v = this.sfxVolume;

    const sample = this.soundBuffers.get(sfx);
    if (sample) {
      try {
        const source = ctx.createBufferSource();
        source.buffer = sample;
        const gainNode = ctx.createGain();
        gainNode.gain.value = Math.min(1, v * 0.9);
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        source.start();
        return;
      } catch {}
    }

    switch (sfx) {
      case 'punch':
        this.tone(ctx, 'square', 165, 65, 0.08, 0.16 * v);
        break;
      case 'rock_hit':
        this.tone(ctx, 'triangle', 520, 240, 0.07, 0.18 * v);
        break;
      case 'break':
        this.tone(ctx, 'sawtooth', 240, 80, 0.13, 0.2 * v);
        this.tone(ctx, 'square', 380, 140, 0.09, 0.12 * v, 0.03);
        break;
      case 'place':
        this.tone(ctx, 'triangle', 220, 310, 0.07, 0.18 * v);
        break;
      case 'seed':
        this.tone(ctx, 'sine', 360, 580, 0.1, 0.16 * v);
        break;
      case 'harvest':
        this.tone(ctx, 'triangle', 440, 660, 0.1, 0.18 * v);
        this.tone(ctx, 'triangle', 660, 880, 0.12, 0.18 * v, 0.07);
        break;
      case 'splice':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
          this.tone(ctx, 'triangle', f, f * 1.04, 0.14, 0.2 * v, idx * 0.065);
        });
        break;
      case 'gem':
        this.tone(ctx, 'sine', 980, 1420, 0.11, 0.16 * v);
        break;
      case 'pickup':
        this.tone(ctx, 'sine', 520, 780, 0.08, 0.15 * v);
        break;
      case 'jump':
        this.tone(ctx, 'sine', 210, 440, 0.11, 0.14 * v);
        break;
      case 'wing':
        this.tone(ctx, 'triangle', 320, 620, 0.13, 0.17 * v);
        break;
      case 'hurt':
        this.tone(ctx, 'sawtooth', 320, 110, 0.22, 0.24 * v);
        break;
      case 'bumper':
        this.tone(ctx, 'sine', 300, 920, 0.2, 0.22 * v);
        break;
      case 'warp':
        this.tone(ctx, 'sine', 280, 840, 0.24, 0.2 * v);
        break;
      case 'lock':
        this.tone(ctx, 'square', 440, 660, 0.09, 0.2 * v);
        this.tone(ctx, 'square', 880, 880, 0.16, 0.2 * v, 0.09);
        break;
      case 'ui':
        this.tone(ctx, 'triangle', 640, 760, 0.045, 0.12 * v);
        break;
    }
  }
}
