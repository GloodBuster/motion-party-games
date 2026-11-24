import { describe, expect, it } from 'vitest';
import { BowlingScorer } from '../src/bowling-scoring.js';

describe('BowlingScorer', () => {
  it('scores a perfect 300 game across 12 consecutive strikes', () => {
    const scorer = new BowlingScorer();
    for (let i = 0; i < 12; i++) {
      const outcome = scorer.recordRoll(10);
      expect(outcome.isStrike).toBe(true);
      expect(outcome.gameOver).toBe(i === 11);
    }

    expect(scorer.isGameOver()).toBe(true);
    expect(scorer.getTotalScore()).toBe(300);
    const frames = scorer.getFrames();
    expect(frames[9]?.symbols).toEqual(['X', 'X', 'X']);
    expect(frames[9]?.cumulativeScore).toBe(300);
  });

  it('scores an all-gutter game as 0 in 20 rolls', () => {
    const scorer = new BowlingScorer();
    for (let i = 0; i < 20; i++) {
      const outcome = scorer.recordRoll(0);
      expect(outcome.isGutter).toBe(true);
      expect(outcome.gameOver).toBe(i === 19);
    }

    expect(scorer.getTotalScore()).toBe(0);
    expect(scorer.isGameOver()).toBe(true);
  });

  it('scores an all-spares (5 + 5) game as 150 in 21 rolls', () => {
    const scorer = new BowlingScorer();
    for (let i = 0; i < 21; i++) {
      scorer.recordRoll(5);
    }

    expect(scorer.isGameOver()).toBe(true);
    expect(scorer.getTotalScore()).toBe(150);
    expect(scorer.getFrames()[9]?.symbols).toEqual(['5', '/', '5']);
  });

  it('handles mixed frames and 10th frame strike + spare correctly', () => {
    const scorer = new BowlingScorer();
    // 9 open frames of 4 + 3 = 7 each -> 63
    for (let f = 0; f < 9; f++) {
      scorer.recordRoll(4);
      scorer.recordRoll(3);
    }
    // Frame 10: X, 7, 3 -> 20 -> total 83
    const r1 = scorer.recordRoll(10);
    expect(r1.needsPinReset).toBe(true);
    const r2 = scorer.recordRoll(7);
    expect(r2.needsPinReset).toBe(false);
    expect(scorer.getPinsStanding()).toBe(3);
    const r3 = scorer.recordRoll(3);
    expect(r3.isSpare).toBe(true);
    expect(r3.gameOver).toBe(true);

    expect(scorer.getTotalScore()).toBe(83);
    expect(scorer.getFrames()[9]?.symbols).toEqual(['X', '7', '/']);
  });
});
