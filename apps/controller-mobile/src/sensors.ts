import {
  GravityFilter,
  clamp,
  type HapticPattern,
  type SensorTelemetryPacket,
} from '@motion-party/shared';

interface DeviceMotionConstructorWithPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export interface SensorStatus {
  permissionGranted: boolean;
  hasImuEvents: boolean;
  wakeLockActive: boolean;
  note: string;
}

export type TelemetryListener = (packet: SensorTelemetryPacket) => void;
export type StatusListener = (status: SensorStatus) => void;

export class MobileSensorManager {
  private readonly gravityFilter = new GravityFilter(0.8);
  private seq = 0;
  private lastEmitMs = 0;
  private holding = false;

  private rawPitch = 0;
  private rawRoll = 0;
  private rollOffset = 0;
  private yawRate = 0;
  private rollRate = 0;

  private wakeLockSentinel: WakeLockSentinel | null = null;
  private listening = false;
  private status: SensorStatus = {
    permissionGranted: false,
    hasImuEvents: false,
    wakeLockActive: false,
    note: 'Sensores inactivos',
  };

  private readonly onTelemetry: TelemetryListener;
  private readonly onStatus: StatusListener;

  constructor(onTelemetry: TelemetryListener, onStatus: StatusListener) {
    this.onTelemetry = onTelemetry;
    this.onStatus = onStatus;
  }

  setHolding(holding: boolean): void {
    this.holding = holding;
  }

  recenter(): void {
    this.rollOffset = this.rawRoll;
    this.gravityFilter.reset();
  }

  getStatus(): SensorStatus {
    return { ...this.status };
  }

  /**
   * Debe invocarse EXCLUSIVAMENTE dentro de un gesto explícito del usuario (click/touch)
   * para cumplir con DeviceMotionEvent.requestPermission() en iOS/iPadOS.
   */
  async startFromUserGesture(): Promise<SensorStatus> {
    let permissionGranted = true;
    let note = 'Sensores activos';

    if (!window.isSecureContext) {
      permissionGranted = false;
      note = 'Se requiere HTTPS para leer el acelerómetro en móvil (usa modo simulador en HTTP).';
    } else {
      try {
        const motionCtor = window.DeviceMotionEvent as unknown as
          | DeviceMotionConstructorWithPermission
          | undefined;
        if (motionCtor && typeof motionCtor.requestPermission === 'function') {
          const res = await motionCtor.requestPermission();
          if (res !== 'granted') {
            permissionGranted = false;
            note = 'Permiso de movimiento denegado en iOS.';
          }
        }

        const orientCtor = window.DeviceOrientationEvent as unknown as
          | DeviceMotionConstructorWithPermission
          | undefined;
        if (permissionGranted && orientCtor && typeof orientCtor.requestPermission === 'function') {
          const res = await orientCtor.requestPermission();
          if (res !== 'granted') {
            note = 'Orientación denegada; usando acelerómetro.';
          }
        }
      } catch (err) {
        permissionGranted = false;
        note = `No se pudieron activar los sensores: ${(err as Error).message}`;
      }
    }

    this.status.permissionGranted = permissionGranted;
    this.status.note = note;

    if (permissionGranted && !this.listening) {
      this.listening = true;
      window.addEventListener('deviceorientation', this.handleOrientation, true);
      window.addEventListener('devicemotion', this.handleMotion, true);
    }

    await this.requestWakeLock();
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.onStatus(this.getStatus());
    return this.getStatus();
  }

  stop(): void {
    if (this.listening) {
      window.removeEventListener('deviceorientation', this.handleOrientation, true);
      window.removeEventListener('devicemotion', this.handleMotion, true);
      this.listening = false;
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    void this.releaseWakeLock();
  }

  triggerHaptic(pattern: HapticPattern): void {
    if (typeof navigator.vibrate !== 'function') return;
    switch (pattern) {
      case 'grab':
        navigator.vibrate(25);
        break;
      case 'release':
        navigator.vibrate([30, 20, 45]);
        break;
      case 'pin_hit':
        navigator.vibrate(40);
        break;
      case 'spare':
        navigator.vibrate([40, 40, 80]);
        break;
      case 'strike':
        navigator.vibrate([60, 40, 60, 40, 120]);
        break;
      case 'gutter':
        navigator.vibrate([120]);
        break;
    }
  }

  private async requestWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator) || !navigator.wakeLock) {
      this.status.wakeLockActive = false;
      this.onStatus(this.getStatus());
      return;
    }

    try {
      this.wakeLockSentinel = await navigator.wakeLock.request('screen');
      this.status.wakeLockActive = true;
      this.wakeLockSentinel.addEventListener('release', () => {
        this.status.wakeLockActive = false;
        this.onStatus(this.getStatus());
      });
    } catch {
      this.status.wakeLockActive = false;
    }
    this.onStatus(this.getStatus());
  }

  private async releaseWakeLock(): Promise<void> {
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch {
        // Ignorar errores al liberar
      }
      this.wakeLockSentinel = null;
    }
    this.status.wakeLockActive = false;
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      void this.requestWakeLock();
    }
  };

  private readonly handleOrientation = (event: DeviceOrientationEvent): void => {
    if (typeof event.beta === 'number') {
      this.rawPitch = event.beta;
    }
    if (typeof event.gamma === 'number') {
      this.rawRoll = event.gamma;
    }
  };

  private readonly handleMotion = (event: DeviceMotionEvent): void => {
    const now = performance.now();
    // Limitar a ~60 Hz (~15ms mínimo entre envíos)
    if (now - this.lastEmitMs < 15) return;
    this.lastEmitMs = now;

    let ax = 0;
    let ay = 0;
    let az = 0;

    const accel = event.acceleration;
    const hasLinearAccel =
      accel !== null &&
      accel !== undefined &&
      (accel.x !== null || accel.y !== null || accel.z !== null);

    if (hasLinearAccel && accel) {
      ax = accel.x ?? 0;
      ay = accel.y ?? 0;
      az = accel.z ?? 0;
    } else if (event.accelerationIncludingGravity) {
      // Fallback para dispositivos Android donde event.acceleration viene null
      const linear = this.gravityFilter.extractLinearAcceleration({
        x: event.accelerationIncludingGravity.x ?? 0,
        y: event.accelerationIncludingGravity.y ?? 0,
        z: event.accelerationIncludingGravity.z ?? 0,
      });
      ax = linear.x;
      ay = linear.y;
      az = linear.z;
    }

    if (event.rotationRate) {
      this.yawRate = event.rotationRate.alpha ?? 0;
      this.rollRate = event.rotationRate.gamma ?? 0;
    }

    if (!this.status.hasImuEvents) {
      this.status.hasImuEvents = true;
      this.status.note = 'Sensores IMU recibiendo datos (~60 Hz)';
      this.onStatus(this.getStatus());
    }

    const accelMag = Math.hypot(ax, ay, az);
    // Componente aproximada hacia delante en agarre vertical tipo Wii Remote
    const forwardAccel = Math.hypot(ay, az) * (ay + az >= 0 ? 1 : -1);
    const relativeRoll = clamp(this.rawRoll - this.rollOffset, -90, 90);

    this.seq += 1;
    this.onTelemetry({
      type: 'telemetry',
      seq: this.seq,
      ts: Date.now(),
      pitch: Number(clamp(this.rawPitch, -180, 180).toFixed(1)),
      roll: Number(relativeRoll.toFixed(1)),
      yawRate: Number(this.yawRate.toFixed(1)),
      rollRate: Number(this.rollRate.toFixed(1)),
      accelMag: Number(accelMag.toFixed(2)),
      forwardAccel: Number(forwardAccel.toFixed(2)),
      holding: this.holding,
    });
  };
}
