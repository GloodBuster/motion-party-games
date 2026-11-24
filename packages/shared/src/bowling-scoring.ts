export interface FrameDisplay {
  frameNumber: number; // 1..10
  rolls: number[];
  symbols: string[];
  cumulativeScore: number | null;
  isComplete: boolean;
}

export interface RollOutcome {
  frameNumber: number;
  rollInFrame: number;
  pinsKnocked: number;
  isStrike: boolean;
  isSpare: boolean;
  isGutter: boolean;
  frameComplete: boolean;
  needsPinReset: boolean;
  gameOver: boolean;
  totalScore: number;
}

export interface BowlingBoardSnapshot {
  frames: FrameDisplay[];
  currentFrame: number; // 1..10
  currentRoll: number; // 1..3
  pinsStanding: number;
  totalScore: number;
  isGameOver: boolean;
}

/**
 * Motor oficial de puntuación de bolos a 10 frames (strikes, spares y 3er tiro extra en el frame 10).
 */
export class BowlingScorer {
  private readonly frameRolls: number[][] = Array.from({ length: 10 }, () => []);
  private frameIdx = 0; // 0..9
  private pinsRemaining = 10;
  private finished = false;

  reset(): void {
    for (let i = 0; i < 10; i++) {
      this.frameRolls[i] = [];
    }
    this.frameIdx = 0;
    this.pinsRemaining = 10;
    this.finished = false;
  }

  isGameOver(): boolean {
    return this.finished;
  }

  getPinsStanding(): number {
    return this.pinsRemaining;
  }

  getCurrentFrameNumber(): number {
    return Math.min(this.frameIdx + 1, 10);
  }

  getCurrentRollNumber(): number {
    if (this.finished) return 0;
    return (this.frameRolls[this.frameIdx]?.length ?? 0) + 1;
  }

  recordRoll(rawPinsKnocked: number): RollOutcome {
    if (this.finished) {
      throw new Error('Cannot record a roll after game over.');
    }

    const pinsKnocked = Math.max(0, Math.min(this.pinsRemaining, Math.round(rawPinsKnocked)));
    const frameNumber = this.frameIdx + 1;
    const currentRolls = this.frameRolls[this.frameIdx]!;
    currentRolls.push(pinsKnocked);
    const rollInFrame = currentRolls.length;
    const isGutter = pinsKnocked === 0;

    let isStrike = false;
    let isSpare = false;
    let frameComplete = false;
    let needsPinReset = false;

    if (this.frameIdx < 9) {
      if (rollInFrame === 1 && pinsKnocked === 10) {
        isStrike = true;
        frameComplete = true;
        needsPinReset = true;
        this.frameIdx += 1;
        this.pinsRemaining = 10;
      } else if (rollInFrame === 1) {
        this.pinsRemaining = 10 - pinsKnocked;
        needsPinReset = false;
      } else {
        isSpare = currentRolls[0]! + pinsKnocked === 10;
        frameComplete = true;
        needsPinReset = true;
        this.frameIdx += 1;
        this.pinsRemaining = 10;
      }
    } else {
      // Frame 10
      const r1 = currentRolls[0]!;
      const r2 = currentRolls[1];

      if (rollInFrame === 1) {
        if (r1 === 10) {
          isStrike = true;
          this.pinsRemaining = 10;
          needsPinReset = true;
        } else {
          this.pinsRemaining = 10 - r1;
          needsPinReset = false;
        }
      } else if (rollInFrame === 2) {
        if (r1 === 10) {
          if (r2 === 10) {
            isStrike = true;
            this.pinsRemaining = 10;
            needsPinReset = true;
          } else {
            this.pinsRemaining = 10 - r2!;
            needsPinReset = false;
          }
        } else if (r1 + r2! === 10) {
          isSpare = true;
          this.pinsRemaining = 10;
          needsPinReset = true;
        } else {
          frameComplete = true;
          this.finished = true;
          needsPinReset = true;
          this.pinsRemaining = 0;
        }
      } else {
        // 3er tiro del frame 10
        const r3 = currentRolls[2]!;
        if (this.pinsRemaining === 10 && r3 === 10) {
          isStrike = true;
        } else if (this.pinsRemaining < 10 && r3 === this.pinsRemaining) {
          isSpare = true;
        }
        frameComplete = true;
        this.finished = true;
        needsPinReset = true;
        this.pinsRemaining = 0;
      }
    }

    return {
      frameNumber,
      rollInFrame,
      pinsKnocked,
      isStrike,
      isSpare,
      isGutter,
      frameComplete,
      needsPinReset,
      gameOver: this.finished,
      totalScore: this.getTotalScore(),
    };
  }

  getTotalScore(): number {
    const frames = this.getFrames();
    let total = 0;
    for (const f of frames) {
      if (f.cumulativeScore !== null) {
        total = f.cumulativeScore;
      }
    }
    return total;
  }

  getFrames(): FrameDisplay[] {
    const allRolls: number[] = [];
    const frameStartIndex: number[] = [];

    for (let i = 0; i < 10; i++) {
      frameStartIndex.push(allRolls.length);
      allRolls.push(...this.frameRolls[i]!);
    }

    const displays: FrameDisplay[] = [];
    let runningTotal = 0;

    for (let i = 0; i < 10; i++) {
      const rolls = [...this.frameRolls[i]!];
      const start = frameStartIndex[i]!;
      const symbols = formatFrameSymbols(i, rolls);

      let frameScore: number | null = null;
      let isComplete = false;

      if (i < 9) {
        if (rolls.length === 1 && rolls[0] === 10) {
          isComplete = true;
          const b1 = allRolls[start + 1];
          const b2 = allRolls[start + 2];
          if (b1 !== undefined && b2 !== undefined) {
            frameScore = 10 + b1 + b2;
          }
        } else if (rolls.length === 2) {
          isComplete = true;
          const sum = rolls[0]! + rolls[1]!;
          if (sum === 10) {
            const b1 = allRolls[start + 2];
            if (b1 !== undefined) {
              frameScore = 10 + b1;
            }
          } else {
            frameScore = sum;
          }
        }
      } else {
        // Frame 10
        const r1 = rolls[0];
        const r2 = rolls[1];
        const r3 = rolls[2];
        if (r1 !== undefined && r2 !== undefined) {
          if (r1 === 10 || r1 + r2 === 10) {
            if (r3 !== undefined) {
              isComplete = true;
              frameScore = r1 + r2 + r3;
            }
          } else {
            isComplete = true;
            frameScore = r1 + r2;
          }
        }
      }

      let cumulativeScore: number | null = null;
      if (frameScore !== null) {
        runningTotal += frameScore;
        cumulativeScore = runningTotal;
      }

      displays.push({
        frameNumber: i + 1,
        rolls,
        symbols,
        cumulativeScore,
        isComplete,
      });
    }

    return displays;
  }

  getSnapshot(): BowlingBoardSnapshot {
    return {
      frames: this.getFrames(),
      currentFrame: this.getCurrentFrameNumber(),
      currentRoll: this.getCurrentRollNumber(),
      pinsStanding: this.pinsRemaining,
      totalScore: this.getTotalScore(),
      isGameOver: this.finished,
    };
  }
}

function formatFrameSymbols(frameIdx: number, rolls: number[]): string[] {
  const fmt = (n: number): string => (n === 0 ? '-' : String(n));

  if (frameIdx < 9) {
    if (rolls.length === 0) return ['', ''];
    if (rolls[0] === 10) return ['', 'X'];
    if (rolls.length === 1) return [fmt(rolls[0]!), ''];
    const r1 = rolls[0]!;
    const r2 = rolls[1]!;
    return [fmt(r1), r1 + r2 === 10 ? '/' : fmt(r2)];
  }

  // Frame 10 (hasta 3 casillas)
  const out = ['', '', ''];
  if (rolls[0] === undefined) return out;
  out[0] = rolls[0] === 10 ? 'X' : fmt(rolls[0]);

  if (rolls[1] === undefined) return out;
  if (rolls[0] === 10) {
    out[1] = rolls[1] === 10 ? 'X' : fmt(rolls[1]);
  } else if (rolls[0] + rolls[1] === 10) {
    out[1] = '/';
  } else {
    out[1] = fmt(rolls[1]);
  }

  if (rolls[2] === undefined) return out;
  if (rolls[0] === 10 && rolls[1] < 10 && rolls[1] + rolls[2] === 10) {
    out[2] = '/';
  } else if (rolls[2] === 10 && (rolls[1] === 10 || rolls[0] + rolls[1] === 10)) {
    out[2] = 'X';
  } else {
    out[2] = fmt(rolls[2]);
  }

  return out;
}
