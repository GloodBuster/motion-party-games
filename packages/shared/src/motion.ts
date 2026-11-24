import type { ReleaseQuality, SensorTelemetryPacket, ThrowPayload } from './protocol.js';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Filtro paso bajo para aislar y restar la gravedad cuando el navegador Android
 * reporta `event.acceleration === null` y solo entrega `accelerationIncludingGravity`.
 */
export class GravityFilter {
  private readonly alpha: number;
  private initialized = false;
  private gx = 0;
  private gy = 0;
  private gz = 0;

  constructor(alpha = 0.8) {
    this.alpha = alpha;
  }

  reset(): void {
    this.initialized = false;
    this.gx = 0;
    this.gy = 0;
    this.gz = 0;
  }

  /**
   * Recibe la aceleración incluyendo gravedad y devuelve la aceleración lineal estimada.
   */
  extractLinearAcceleration(accelWithGravity: Vec3): Vec3 {
    if (!this.initialized) {
      this.gx = accelWithGravity.x;
      this.gy = accelWithGravity.y;
      this.gz = accelWithGravity.z;
      this.initialized = true;
      return { x: 0, y: 0, z: 0 };
    }

    this.gx = this.alpha * this.gx + (1 - this.alpha) * accelWithGravity.x;
    this.gy = this.alpha * this.gy + (1 - this.alpha) * accelWithGravity.y;
    this.gz = this.alpha * this.gz + (1 - this.alpha) * accelWithGravity.z;

    return {
      x: accelWithGravity.x - this.gx,
      y: accelWithGravity.y - this.gy,
      z: accelWithGravity.z - this.gz,
    };
  }
}

export interface PacketGuardStats {
  received: number;
  accepted: number;
  dropped: number;
}

/**
 * Descarta paquetes de telemetría desordenados o más viejos que el último procesado
 * (imprescindible en canales WebRTC no fiables/sin orden).
 */
export class PacketOrderingGuard {
  private lastTs = -Infinity;
  private lastSeq = -1;
  private received = 0;
  private accepted = 0;
  private dropped = 0;

  accept(packet: Pick<SensorTelemetryPacket, 'ts' | 'seq'>): boolean {
    this.received += 1;

    if (packet.ts < this.lastTs) {
      this.dropped += 1;
      return false;
    }

    if (packet.ts === this.lastTs && packet.seq <= this.lastSeq) {
      this.dropped += 1;
      return false;
    }

    this.lastTs = packet.ts;
    this.lastSeq = packet.seq;
    this.accepted += 1;
    return true;
  }

  reset(): void {
    this.lastTs = -Infinity;
    this.lastSeq = -1;
    this.received = 0;
    this.accepted = 0;
    this.dropped = 0;
  }

  getStats(): PacketGuardStats {
    return {
      received: this.received,
      accepted: this.accepted,
      dropped: this.dropped,
    };
  }
}

export interface SwingSample {
  ts: number;
  accelMag: number;
  forwardAccel: number;
  roll: number;
  rollRate: number;
  yawRate: number;
}

export type SwingEvaluation =
  | { status: 'throw'; payload: ThrowPayload }
  | { status: 'cancelled'; reason: 'swing_too_weak' };

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export interface SwingDetectorConfig {
  windowMs?: number;
  minPeakAccel?: number;
  maxPeakAccel?: number;
  minSpeed?: number;
  maxSpeed?: number;
}

/**
 * Analiza una ventana circular de muestras IMU mientras el jugador mantiene
 * pulsado el botón de agarre y calcula velocidad, efecto (hook) y calidad al soltar.
 */
export class SwingDetector {
  private readonly windowMs: number;
  private readonly minPeakAccel: number;
  private readonly maxPeakAccel: number;
  private readonly minSpeed: number;
  private readonly maxSpeed: number;
  private samples: SwingSample[] = [];
  private holding = false;

  constructor(config: SwingDetectorConfig = {}) {
    this.windowMs = config.windowMs ?? 480;
    this.minPeakAccel = config.minPeakAccel ?? 2.2;
    this.maxPeakAccel = config.maxPeakAccel ?? 22.0;
    this.minSpeed = config.minSpeed ?? 4.8;
    this.maxSpeed = config.maxSpeed ?? 13.5;
  }

  startHold(): void {
    this.holding = true;
    this.samples = [];
  }

  isHolding(): boolean {
    return this.holding;
  }

  pushSample(sample: SwingSample): void {
    if (!this.holding) return;
    this.samples.push(sample);
    const cutoff = sample.ts - this.windowMs;
    while (this.samples.length > 0 && this.samples[0]!.ts < cutoff) {
      this.samples.shift();
    }
  }

  cancelHold(): void {
    this.holding = false;
    this.samples = [];
  }

  /**
   * Evalúa el swing acumulado al soltar el botón en pantalla.
   */
  finishHold(releaseTs: number, laneOffset: number, baseAimAngle: number): SwingEvaluation {
    this.holding = false;
    const cutoff = releaseTs - this.windowMs;
    const recent = this.samples.filter((s) => s.ts >= cutoff);
    this.samples = [];

    if (recent.length === 0) {
      return { status: 'cancelled', reason: 'swing_too_weak' };
    }

    let peakSample = recent[0]!;
    for (const sample of recent) {
      if (sample.accelMag > peakSample.accelMag) {
        peakSample = sample;
      }
    }

    if (peakSample.accelMag < this.minPeakAccel) {
      return { status: 'cancelled', reason: 'swing_too_weak' };
    }

    const normalizedPower = clamp(
      (peakSample.accelMag - this.minPeakAccel) / (this.maxPeakAccel - this.minPeakAccel),
      0,
      1,
    );
    // Curva suave (^0.82) para que swings moderados de muñeca sean cómodos y seguros
    const easedPower = Math.pow(normalizedPower, 0.82);
    const speed = Number((this.minSpeed + easedPower * (this.maxSpeed - this.minSpeed)).toFixed(2));

    // Promedio ponderado de los últimos ~120ms para suavizar el efecto (hook) de muñeca
    const spinWindow = recent.filter((s) => s.ts >= releaseTs - 140);
    const spinSamples = spinWindow.length > 0 ? spinWindow : [peakSample];
    const avgRoll = spinSamples.reduce((acc, s) => acc + s.roll, 0) / spinSamples.length;
    const avgRollRate = spinSamples.reduce((acc, s) => acc + s.rollRate, 0) / spinSamples.length;

    const spinFromAngle = clamp(avgRoll / 45, -1, 1);
    const spinFromRate = clamp(avgRollRate / 320, -1, 1);
    const spin = Number(clamp(spinFromAngle * 0.65 + spinFromRate * 0.35, -1, 1).toFixed(3));

    // Ligera influencia del giro horizontal en la dirección final, acotada para mantener diversión
    const yawDeviation = clamp(peakSample.yawRate * 0.015, -4, 4);
    const aimAngle = Number(clamp(baseAimAngle + yawDeviation, -16, 16).toFixed(2));

    const deltaPeakMs = Math.max(0, releaseTs - peakSample.ts);
    let releaseQuality: ReleaseQuality = 'early_or_late';
    if (deltaPeakMs <= 180) {
      releaseQuality = 'perfect';
    } else if (deltaPeakMs <= 320) {
      releaseQuality = 'good';
    }

    return {
      status: 'throw',
      payload: {
        speed,
        spin,
        aimAngle,
        laneOffset: Number(clamp(laneOffset, -1, 1).toFixed(3)),
        peakAccel: Number(peakSample.accelMag.toFixed(2)),
        releaseQuality,
      },
    };
  }
}

/**
 * Construye un lanzamiento válido a partir de controles simulados (modo pruebas en PC).
 */
export function buildSimulatedThrow(params: {
  powerPercent: number; // 0..100
  spin: number; // -1..1
  laneOffset: number; // -1..1
  aimAngle: number; // -16..16
}): ThrowPayload {
  const power = clamp(params.powerPercent / 100, 0.15, 1);
  const speed = Number((4.8 + power * (13.5 - 4.8)).toFixed(2));
  return {
    speed,
    spin: Number(clamp(params.spin, -1, 1).toFixed(3)),
    laneOffset: Number(clamp(params.laneOffset, -1, 1).toFixed(3)),
    aimAngle: Number(clamp(params.aimAngle, -16, 16).toFixed(2)),
    peakAccel: Number((2.5 + power * 18).toFixed(2)),
    releaseQuality: 'perfect',
    simulated: true,
  };
}
