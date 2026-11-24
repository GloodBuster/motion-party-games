/**
 * Sintetizador ligero de efectos de bolos con Web Audio API (sin archivos de audio externos).
 */
export class BowlingAudio {
  private ctx: AudioContext | null = null;
  private muted = false;
  private rollNode: AudioBufferSourceNode | null = null;
  private rollGain: GainNode | null = null;

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted) {
      this.stopRoll();
    }
    return this.muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return null;
      this.ctx = new AudioCtor();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  startRoll(speed: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.stopRoll();

    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 110 + Math.min(speed * 14, 180);

    const gain = ctx.createGain();
    gain.gain.value = 0.09;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();

    this.rollNode = noise;
    this.rollGain = gain;
  }

  stopRoll(): void {
    if (this.rollGain && this.ctx) {
      try {
        this.rollGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);
      } catch {
        // Ignorar
      }
    }
    if (this.rollNode) {
      try {
        this.rollNode.stop(this.ctx ? this.ctx.currentTime + 0.14 : 0);
      } catch {
        // Ignorar
      }
      this.rollNode = null;
      this.rollGain = null;
    }
  }

  playPinImpact(intensity = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const count = Math.min(6, Math.max(2, Math.round(intensity * 5)));

    for (let i = 0; i < count; i++) {
      const start = now + i * 0.028 + Math.random() * 0.02;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(620 + Math.random() * 580, start);
      osc.frequency.exponentialRampToValueAtTime(180 + Math.random() * 120, start + 0.09);

      gain.gain.setValueAtTime(0.16 * Math.min(1, intensity), start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.11);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.12);
    }
  }

  playGutter(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(135, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.25);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  playStrike(): void {
    this.playChime([523.25, 659.25, 783.99, 1046.5], 0.085);
  }

  playSpare(): void {
    this.playChime([523.25, 659.25, 783.99], 0.095);
  }

  private playChime(freqs: number[], stepSec: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    freqs.forEach((freq, idx) => {
      const start = now + idx * stepSec;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.14, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.36);
    });
  }
}
