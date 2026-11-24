import { describe, expect, it } from 'vitest';
import { BowlingSimulation } from '../src/bowling-physics.js';

describe('BowlingSimulation (Rapier3D physics)', () => {
  it('knocks down multiple pins on a centered fast throw', async () => {
    const sim = await BowlingSimulation.create();
    sim.launchBall({
      speed: 11.2,
      spin: 0.08,
      aimAngle: 0,
      laneOffset: 0.04,
      peakAccel: 15,
      releaseQuality: 'perfect',
    });

    let finished = false;
    let knocked = 0;
    let pinHit = false;

    for (let i = 0; i < 420 && !finished; i++) {
      const ev = sim.step(1 / 60);
      if (ev.firstPinHit) pinHit = true;
      if (ev.rollFinished) {
        finished = true;
        knocked = ev.pinsKnockedThisRoll;
      }
    }

    expect(finished).toBe(true);
    expect(pinHit).toBe(true);
    expect(knocked).toBeGreaterThanOrEqual(6);
    sim.dispose();
  });

  it('registers a gutter ball with 0 pins knocked when aimed hard into the gutter', async () => {
    const sim = await BowlingSimulation.create();
    sim.launchBall({
      speed: 9.0,
      spin: 0,
      aimAngle: 15,
      laneOffset: 0.9,
      peakAccel: 11,
      releaseQuality: 'good',
    });

    let finished = false;
    let enteredGutter = false;
    let knocked = -1;

    for (let i = 0; i < 420 && !finished; i++) {
      const ev = sim.step(1 / 60);
      if (ev.enteredGutter) enteredGutter = true;
      if (ev.rollFinished) {
        finished = true;
        knocked = ev.pinsKnockedThisRoll;
      }
    }

    expect(finished).toBe(true);
    expect(enteredGutter).toBe(true);
    expect(knocked).toBe(0);
    sim.dispose();
  });

  it('curves ball trajectory laterally when spin is applied', async () => {
    const sim = await BowlingSimulation.create();
    sim.launchBall({
      speed: 9.5,
      spin: -0.9, // curva hacia izquierda (-X)
      aimAngle: 0,
      laneOffset: 0,
      peakAccel: 12,
      releaseQuality: 'perfect',
    });

    for (let i = 0; i < 95; i++) {
      sim.step(1 / 60);
    }

    const pose = sim.getBallPose();
    expect(pose.position.x).toBeLessThan(-0.15);
    sim.dispose();
  });
});
