import { describe, expect, it } from 'vitest';
import {
  GravityFilter,
  PacketOrderingGuard,
  SwingDetector,
  buildSimulatedThrow,
} from '../src/motion.js';

describe('GravityFilter', () => {
  it('converges toward zero linear acceleration under constant gravity', () => {
    const filter = new GravityFilter(0.8);
    const first = filter.extractLinearAcceleration({ x: 0, y: 0, z: 9.81 });
    expect(first).toEqual({ x: 0, y: 0, z: 0 });

    const second = filter.extractLinearAcceleration({ x: 0, y: 0, z: 9.81 });
    expect(Math.abs(second.z)).toBeLessThan(1e-6);
  });

  it('detects sudden motion impulse after gravity baseline is established', () => {
    const filter = new GravityFilter(0.8);
    filter.extractLinearAcceleration({ x: 0, y: 9.81, z: 0 });
    const impulse = filter.extractLinearAcceleration({ x: 6, y: 9.81, z: 0 });
    expect(impulse.x).toBeGreaterThan(4.5);
    expect(Math.abs(impulse.y)).toBeLessThan(0.1);
  });
});

describe('PacketOrderingGuard', () => {
  it('accepts strictly newer packets and drops stale or out-of-order packets', () => {
    const guard = new PacketOrderingGuard();
    expect(guard.accept({ ts: 1000, seq: 1 })).toBe(true);
    expect(guard.accept({ ts: 1016, seq: 2 })).toBe(true);
    expect(guard.accept({ ts: 1005, seq: 3 })).toBe(false);
    expect(guard.accept({ ts: 1016, seq: 2 })).toBe(false);
    expect(guard.accept({ ts: 1016, seq: 4 })).toBe(true);

    expect(guard.getStats()).toEqual({
      received: 5,
      accepted: 3,
      dropped: 2,
    });
  });
});

describe('SwingDetector', () => {
  it('cancels throws when acceleration peak is below minimum threshold', () => {
    const detector = new SwingDetector();
    detector.startHold();
    detector.pushSample({
      ts: 1000,
      accelMag: 0.8,
      forwardAccel: 0.5,
      roll: 0,
      rollRate: 0,
      yawRate: 0,
    });

    const result = detector.finishHold(1080, 0, 0);
    expect(result).toEqual({ status: 'cancelled', reason: 'swing_too_weak' });
  });

  it('produces valid bowling throw speed, spin, and perfect release quality', () => {
    const detector = new SwingDetector();
    detector.startHold();
    detector.pushSample({
      ts: 1000,
      accelMag: 3.1,
      forwardAccel: 2.5,
      roll: -10,
      rollRate: -80,
      yawRate: 5,
    });
    detector.pushSample({
      ts: 1120,
      accelMag: 14.5,
      forwardAccel: 12.0,
      roll: -25,
      rollRate: -160,
      yawRate: 10,
    });

    const result = detector.finishHold(1200, 0.25, -2);
    expect(result.status).toBe('throw');
    if (result.status === 'throw') {
      expect(result.payload.speed).toBeGreaterThan(9);
      expect(result.payload.speed).toBeLessThanOrEqual(13.5);
      expect(result.payload.spin).toBeLessThan(0); // izquierda
      expect(result.payload.laneOffset).toBe(0.25);
      expect(result.payload.releaseQuality).toBe('perfect');
    }
  });

  it('builds bounded simulated throws', () => {
    const simulated = buildSimulatedThrow({
      powerPercent: 85,
      spin: 0.5,
      laneOffset: -0.4,
      aimAngle: 3,
    });
    expect(simulated.simulated).toBe(true);
    expect(simulated.speed).toBeGreaterThan(10);
    expect(simulated.spin).toBe(0.5);
  });
});
