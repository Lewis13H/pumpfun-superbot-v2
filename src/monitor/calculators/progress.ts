// src/monitor/calculators/progress.ts

import { GRADUATION_TARGET_SOL, PROGRESS_MILESTONES } from '../constants';

export class ProgressCalculator {
  /**
   * Calculate bonding curve progress from real SOL reserves
   */
  static calculateProgress(realSolReserves: number): number {
    const progress = (realSolReserves / GRADUATION_TARGET_SOL) * 100;
    return Math.min(progress, 99.99);
  }

  /**
   * Check which milestones have been passed
   */
  static getPassedMilestones(currentProgress: number, lastProgress: number): number[] {
    const passedMilestones: number[] = [];
    
    for (const milestone of PROGRESS_MILESTONES) {
      if (lastProgress < milestone && currentProgress >= milestone) {
        passedMilestones.push(milestone);
      }
    }
    
    return passedMilestones;
  }

  /**
   * Check if bonding curve is complete
   */
  static isComplete(progress: number): boolean {
    return progress >= 99.99;
  }
}
