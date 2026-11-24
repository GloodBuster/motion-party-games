import RAPIER from '@dimforge/rapier3d-compat';
import { clamp, type ThrowPayload } from '@motion-party/shared';

export const LANE_WIDTH = 1.066; // Ancho reglamentario (41.5 pulgadas)
export const LANE_HALF_WIDTH = LANE_WIDTH / 2; // 0.533 m
export const LANE_LENGTH = 20.4; // Desde línea de falta (z=0) hasta fin de pin deck (z=-20.4)
export const HEAD_PIN_Z = -18.29; // 60 pies reglamentarios
export const BALL_RADIUS = 0.1085;
export const PIN_HEIGHT = 0.381;
export const PIN_RADIUS = 0.056;
export const BALL_START_Z = 0.4;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface PinPose {
  id: number;
  active: boolean;
  fallen: boolean;
  position: Vec3Like;
  rotation: QuatLike;
}

export interface BallPose {
  position: Vec3Like;
  rotation: QuatLike;
  speed: number;
  inGutter: boolean;
}

export interface PhysicsStepEvents {
  enteredGutter: boolean;
  firstPinHit: boolean;
  rollFinished: boolean;
  pinsKnockedThisRoll: number;
}

interface PinEntry {
  id: number;
  homeX: number;
  homeZ: number;
  body: RAPIER.RigidBody;
  active: boolean; // false si ya se retiró en el 1er tiro del frame
  fallen: boolean;
}

/**
 * Posiciones oficiales en triángulo equilátero (30.48 cm entre centros).
 */
export const PIN_LAYOUT: ReadonlyArray<{ x: number; z: number }> = (() => {
  const spacing = 0.3048;
  const rowDz = spacing * Math.sin(Math.PI / 3); // ~0.264 m
  const layout: Array<{ x: number; z: number }> = [];
  for (let row = 0; row < 4; row++) {
    const count = row + 1;
    const z = HEAD_PIN_Z - row * rowDz;
    const startX = -((count - 1) * spacing) / 2;
    for (let col = 0; col < count; col++) {
      layout.push({ x: startX + col * spacing, z });
    }
  }
  return layout;
})();

let rapierReady: Promise<void> | null = null;

export async function ensureRapier(): Promise<void> {
  if (!rapierReady) {
    rapierReady = RAPIER.init();
  }
  await rapierReady;
}

/**
 * Simulación física 3D de la pista de bolos con Rapier3D (WASM).
 * Desacoplada de Three.js para poder probarla directamente en Vitest.
 */
export class BowlingSimulation {
  private readonly world: RAPIER.World;
  private readonly ballBody: RAPIER.RigidBody;
  private readonly pins: PinEntry[] = [];

  private rolling = false;
  private currentSpin = 0;
  private rollElapsed = 0;
  private settleElapsed = 0;
  private settling = false;
  private inGutter = false;
  private hitPins = false;
  private standingAtRollStart = 10;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 120;

    this.buildStaticAlley();
    this.ballBody = this.createBallBody();
    this.createPinBodies();
    this.resetBallToApproach(0);
  }

  static async create(): Promise<BowlingSimulation> {
    await ensureRapier();
    return new BowlingSimulation();
  }

  private buildStaticAlley(): void {
    // 1. Pista de madera principal (z = +2.5 hasta z = -20.3)
    const laneCenterZ = -8.9;
    const laneHalfLen = 11.4;
    const laneBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, laneCenterZ),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(LANE_HALF_WIDTH, 0.1, laneHalfLen)
        .setFriction(0.14)
        .setRestitution(0.15),
      laneBody,
    );

    // 2. Canaletas laterales (gutters) bajadas 9 cm respecto a la pista
    for (const side of [-1, 1]) {
      const gutterFloor = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(side * 0.67, -0.19, laneCenterZ),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.14, 0.1, laneHalfLen)
          .setFriction(0.1)
          .setRestitution(0.08),
        gutterFloor,
      );

      // Muro exterior de la canaleta para contener la bola y pinos voladores
      const outerWall = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(side * 0.84, 0.25, laneCenterZ),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.04, 0.5, laneHalfLen)
          .setFriction(0.2)
          .setRestitution(0.25),
        outerWall,
      );
    }

    // 3. Foso trasero y pared amortiguada detrás de los pinos
    const pitFloor = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.45, -21.2),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.95, 0.1, 1.1).setFriction(0.6).setRestitution(0.05),
      pitFloor,
    );

    const backWall = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.2, -21.9),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.95, 0.75, 0.1).setFriction(0.5).setRestitution(0.15),
      backWall,
    );
  }

  private createBallBody(): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, BALL_RADIUS + 0.002, BALL_START_Z)
        .setCcdEnabled(true)
        .setLinearDamping(0.04)
        .setAngularDamping(0.15),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(BALL_RADIUS)
        .setMass(6.8)
        .setFriction(0.12)
        .setRestitution(0.22),
      body,
    );
    return body;
  }

  private createPinBodies(): void {
    PIN_LAYOUT.forEach((pos, idx) => {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, PIN_HEIGHT / 2 + 0.001, pos.z)
          .setLinearDamping(0.18)
          .setAngularDamping(0.22),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(PIN_HEIGHT / 2, PIN_RADIUS)
          .setMass(1.53)
          .setFriction(0.32)
          .setRestitution(0.38),
        body,
      );
      this.pins.push({
        id: idx + 1,
        homeX: pos.x,
        homeZ: pos.z,
        body,
        active: true,
        fallen: false,
      });
    });
  }

  isRolling(): boolean {
    return this.rolling;
  }

  resetAllPins(): void {
    for (const pin of this.pins) {
      pin.active = true;
      pin.fallen = false;
      pin.body.setEnabled(true);
      pin.body.setTranslation({ x: pin.homeX, y: PIN_HEIGHT / 2 + 0.001, z: pin.homeZ }, true);
      pin.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      pin.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      pin.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.standingAtRollStart = 10;
  }

  /**
   * Retira los pinos ya derribados para preparar el 2do tiro del mismo frame
   * y estabiliza en pie los restantes.
   */
  clearFallenPinsForNextRoll(): void {
    let remaining = 0;
    for (const pin of this.pins) {
      if (!pin.active || pin.fallen) {
        pin.active = false;
        pin.fallen = true;
        pin.body.setEnabled(false);
        pin.body.setTranslation({ x: pin.homeX, y: -5, z: pin.homeZ }, false);
      } else {
        remaining += 1;
        pin.body.setTranslation({ x: pin.homeX, y: PIN_HEIGHT / 2 + 0.001, z: pin.homeZ }, true);
        pin.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        pin.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        pin.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    this.standingAtRollStart = remaining;
  }

  resetBallToApproach(laneOffset: number): void {
    const x = clamp(laneOffset, -1, 1) * (LANE_HALF_WIDTH - BALL_RADIUS - 0.03);
    this.rolling = false;
    this.settling = false;
    this.inGutter = false;
    this.hitPins = false;
    this.rollElapsed = 0;
    this.settleElapsed = 0;
    this.currentSpin = 0;

    this.ballBody.setEnabled(true);
    this.ballBody.setTranslation({ x, y: BALL_RADIUS + 0.002, z: BALL_START_Z }, true);
    this.ballBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  launchBall(payload: ThrowPayload): void {
    this.resetBallToApproach(payload.laneOffset);
    this.standingAtRollStart = this.pins.filter((p) => p.active && !p.fallen).length;

    const speed = clamp(payload.speed, 4.5, 14.5);
    const angleRad = (clamp(payload.aimAngle, -16, 16) * Math.PI) / 180;
    const vx = Math.sin(angleRad) * speed;
    const vz = -Math.cos(angleRad) * speed;

    this.currentSpin = clamp(payload.spin, -1, 1);
    this.rolling = true;
    this.rollElapsed = 0;
    this.settleElapsed = 0;
    this.settling = false;
    this.inGutter = false;
    this.hitPins = false;

    this.ballBody.setLinvel({ x: vx, y: 0, z: vz }, true);
    // Velocidad angular inicial coherente con rodado + efecto lateral
    this.ballBody.setAngvel(
      {
        x: vz / BALL_RADIUS,
        y: -this.currentSpin * 9,
        z: -this.currentSpin * 16,
      },
      true,
    );
  }

  step(dtSeconds: number): PhysicsStepEvents {
    const events: PhysicsStepEvents = {
      enteredGutter: false,
      firstPinHit: false,
      rollFinished: false,
      pinsKnockedThisRoll: 0,
    };

    if (!this.rolling) {
      return events;
    }

    const fixedStep = 1 / 120;
    const steps = Math.max(1, Math.min(8, Math.round(dtSeconds / fixedStep)));

    for (let s = 0; s < steps; s++) {
      this.applyHookAndGutterGuidance(fixedStep, events);
      this.world.step();
      this.rollElapsed += fixedStep;

      if (!this.hitPins) {
        const hitNow = this.checkAnyPinDisturbed();
        if (hitNow) {
          this.hitPins = true;
          events.firstPinHit = true;
        }
      }

      const bPos = this.ballBody.translation();
      const bVel = this.ballBody.linvel();
      const ballSpeed = Math.hypot(bVel.x, bVel.z);

      if (
        !this.settling &&
        (bPos.z < HEAD_PIN_Z + 0.5 ||
          bPos.z < -20.5 ||
          (this.rollElapsed > 1.4 && ballSpeed < 0.35) ||
          this.rollElapsed > 5.5)
      ) {
        this.settling = true;
        this.settleElapsed = 0;
      }

      if (this.settling) {
        this.settleElapsed += fixedStep;
      }
    }

    this.updateFallenStatus();

    if (this.settling) {
      const settledEarly = this.settleElapsed > 0.9 && this.areAllPinsCalm();
      const maxWaitReached = this.settleElapsed >= 2.25 || this.rollElapsed >= 7.5;
      if (settledEarly || maxWaitReached) {
        this.rolling = false;
        this.settling = false;
        const standingNow = this.pins.filter((p) => p.active && !p.fallen).length;
        events.pinsKnockedThisRoll = Math.max(0, this.standingAtRollStart - standingNow);
        events.rollFinished = true;
      }
    }

    return events;
  }

  private applyHookAndGutterGuidance(dt: number, events: PhysicsStepEvents): void {
    const pos = this.ballBody.translation();
    const vel = this.ballBody.linvel();

    if (!this.inGutter && Math.abs(pos.x) > LANE_HALF_WIDTH + 0.025 && pos.y < 0.11) {
      this.inGutter = true;
      events.enteredGutter = true;
    }

    if (this.inGutter) {
      // Mantener la bola avanzando limpiamente por el fondo de la canaleta
      const gutterCenterX = Math.sign(pos.x) * 0.67;
      const pullX = (gutterCenterX - pos.x) * 14;
      this.ballBody.setLinvel(
        {
          x: vel.x * 0.8 + pullX * dt,
          y: Math.min(vel.y, 0),
          z: Math.min(vel.z, -4.5),
        },
        true,
      );
      return;
    }

    // Curva de efecto (hook): suave en la zona aceitada y más marcada en el tramo final seco
    if (Math.abs(this.currentSpin) > 0.02 && pos.z < -1.0 && pos.z > HEAD_PIN_Z - 0.4 && pos.y < 0.16) {
      const progress = clamp(-pos.z / Math.abs(HEAD_PIN_Z), 0, 1);
      const dryLaneFactor = 0.35 + progress * progress * 1.45;
      const lateralAccel = this.currentSpin * 1.55 * dryLaneFactor;
      this.ballBody.setLinvel(
        {
          x: vel.x + lateralAccel * dt,
          y: vel.y,
          z: vel.z,
        },
        true,
      );
    }
  }

  private checkAnyPinDisturbed(): boolean {
    for (const pin of this.pins) {
      if (!pin.active || pin.fallen) continue;
      const v = pin.body.linvel();
      if (Math.hypot(v.x, v.y, v.z) > 0.45) {
        return true;
      }
    }
    return false;
  }

  private updateFallenStatus(): void {
    for (const pin of this.pins) {
      if (!pin.active || pin.fallen) continue;
      const pos = pin.body.translation();
      const rot = pin.body.rotation();
      // Componente Y del vector local +Y rotado por el cuaternión (cos del ángulo de inclinación)
      const upY = 1 - 2 * (rot.x * rot.x + rot.z * rot.z);
      const disp = Math.hypot(pos.x - pin.homeX, pos.z - pin.homeZ);

      if (upY < 0.87 || pos.y < 0.1 || disp > 0.24) {
        pin.fallen = true;
      }
    }
  }

  private areAllPinsCalm(): boolean {
    for (const pin of this.pins) {
      if (!pin.active) continue;
      const lv = pin.body.linvel();
      const av = pin.body.angvel();
      if (Math.hypot(lv.x, lv.y, lv.z) > 0.12 || Math.hypot(av.x, av.y, av.z) > 0.45) {
        return false;
      }
    }
    return true;
  }

  getBallPose(): BallPose {
    const pos = this.ballBody.translation();
    const rot = this.ballBody.rotation();
    const vel = this.ballBody.linvel();
    return {
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      speed: Math.hypot(vel.x, vel.z),
      inGutter: this.inGutter,
    };
  }

  getPinPoses(): PinPose[] {
    return this.pins.map((pin) => {
      const pos = pin.body.translation();
      const rot = pin.body.rotation();
      return {
        id: pin.id,
        active: pin.active,
        fallen: pin.fallen,
        position: { x: pos.x, y: pos.y, z: pos.z },
        rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      };
    });
  }

  dispose(): void {
    this.world.free();
  }
}
