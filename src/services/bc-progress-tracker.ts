/**
 * Bonding Curve Progress Tracker - Phase 5
 * 
 * Tracks bonding curve completion progress and detects graduations
 * to pump.swap AMM when tokens reach 100% (85 SOL).
 */

import { LAMPORTS_PER_SOL } from '../utils/constants';
import chalk from 'chalk';

/**
 * Progress milestone thresholds
 */
export const PROGRESS_MILESTONES = {
  STARTING: 0,       // 0% - Just launched
  EARLY: 25,         // 25% - Early stage
  BUILDING: 50,      // 50% - Building momentum
  MATURE: 75,        // 75% - Mature curve
  NEAR_GRAD: 90,     // 90% - Close to graduation
  COMPLETE: 100      // 100% - Ready for AMM
};

/**
 * Bonding curve constants
 */
const BONDING_CURVE_START_SOL = 30; // 30 SOL = 0% (starting point)
const BONDING_CURVE_END_SOL = 85; // 85 SOL = 100% complete
const BONDING_CURVE_RANGE = BONDING_CURVE_END_SOL - BONDING_CURVE_START_SOL; // 55 SOL range
const GRADUATION_THRESHOLD = 84.5; // Allow small margin for precision

export interface ProgressData {
  progress: number;
  solInCurve: number;
  solRemaining: number;
  isComplete: boolean;
  milestone: string;
  milestoneEmoji: string;
}

/**
 * Calculate detailed progress information
 */
export function calculateDetailedProgress(virtualSolReserves: bigint): ProgressData {
  const solInCurve = Number(virtualSolReserves) / LAMPORTS_PER_SOL;
  const progress = Math.max(0, Math.min(((solInCurve - BONDING_CURVE_START_SOL) / BONDING_CURVE_RANGE) * 100, 100));
  const solRemaining = Math.max(0, BONDING_CURVE_END_SOL - solInCurve);
  const isComplete = solInCurve >= GRADUATION_THRESHOLD;
  
  // Determine milestone
  let milestone = 'Starting';
  let milestoneEmoji = '🌱';
  
  if (progress >= PROGRESS_MILESTONES.COMPLETE) {
    milestone = 'Complete';
    milestoneEmoji = '🎓';
  } else if (progress >= PROGRESS_MILESTONES.NEAR_GRAD) {
    milestone = 'Near Graduation';
    milestoneEmoji = '🎯';
  } else if (progress >= PROGRESS_MILESTONES.MATURE) {
    milestone = 'Mature';
    milestoneEmoji = '💪';
  } else if (progress >= PROGRESS_MILESTONES.BUILDING) {
    milestone = 'Building';
    milestoneEmoji = '📈';
  } else if (progress >= PROGRESS_MILESTONES.EARLY) {
    milestone = 'Early';
    milestoneEmoji = '🚀';
  }
  
  return {
    progress,
    solInCurve,
    solRemaining,
    isComplete,
    milestone,
    milestoneEmoji
  };
}

/**
 * Format progress for display with enhanced information
 */
export function formatProgressDisplay(progressData: ProgressData): string {
  const { progress, solInCurve, solRemaining, milestone, milestoneEmoji } = progressData;
  
  // Create visual progress bar
  const filled = Math.floor(progress / 5);
  const empty = 20 - filled;
  const progressBar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  
  // Format the display
  let display = `${progress.toFixed(1)}% ${progressBar} ${milestoneEmoji} ${milestone}`;
  
  // Add additional info for high progress
  if (progress >= 90) {
    display += chalk.yellow(` (${solRemaining.toFixed(1)} SOL to grad)`);
  }
  
  return display;
}

/**
 * Track progress changes over time
 */
export class ProgressTracker {
  private progressHistory: Map<string, number[]> = new Map();
  private graduationCandidates: Set<string> = new Set();
  
  /**
   * Update progress for a token
   */
  updateProgress(mintAddress: string, virtualSolReserves: bigint): ProgressData {
    const progressData = calculateDetailedProgress(virtualSolReserves);
    
    // Track history
    if (!this.progressHistory.has(mintAddress)) {
      this.progressHistory.set(mintAddress, []);
    }
    this.progressHistory.get(mintAddress)!.push(progressData.progress);
    
    // Track near-graduation tokens
    if (progressData.progress >= 90 && !progressData.isComplete) {
      this.graduationCandidates.add(mintAddress);
    } else if (progressData.isComplete) {
      this.graduationCandidates.delete(mintAddress);
    }
    
    return progressData;
  }
  
  /**
   * Get progress trend for a token
   */
  getProgressTrend(mintAddress: string): 'rising' | 'falling' | 'stable' | 'unknown' {
    const history = this.progressHistory.get(mintAddress);
    if (!history || history.length < 2) return 'unknown';
    
    const recent = history.slice(-5); // Last 5 data points
    const first = recent[0];
    const last = recent[recent.length - 1];
    
    if (last > first + 1) return 'rising';
    if (last < first - 1) return 'falling';
    return 'stable';
  }
  
  /**
   * Get tokens close to graduation
   */
  getGraduationCandidates(): string[] {
    return Array.from(this.graduationCandidates);
  }
  
  /**
   * Check if a token has graduated based on progress
   */
  checkGraduation(mintAddress: string, virtualSolReserves: bigint): boolean {
    const progressData = calculateDetailedProgress(virtualSolReserves);
    
    if (progressData.isComplete) {
      console.log(chalk.green.bold(`\n🎓 GRADUATION DETECTED! 🎓`));
      console.log(chalk.yellow(`Token: ${mintAddress}`));
      console.log(chalk.cyan(`Final SOL in curve: ${progressData.solInCurve.toFixed(2)} SOL`));
      console.log(chalk.green(`This token is ready to migrate to pump.swap AMM!\n`));
      
      // Remove from candidates
      this.graduationCandidates.delete(mintAddress);
      
      return true;
    }
    
    return false;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      trackedTokens: this.progressHistory.size,
      graduationCandidates: this.graduationCandidates.size,
      candidatesList: Array.from(this.graduationCandidates)
    };
  }
}

/**
 * Detect graduation from transaction logs
 */
export function detectGraduationFromLogs(logs: string[]): {
  isGraduation: boolean;
  mintAddress?: string;
  migrationProgram?: string;
} {
  let isGraduation = false;
  let mintAddress: string | undefined;
  let migrationProgram: string | undefined;
  
  for (const log of logs) {
    // Look for graduation indicators
    if (log.includes('migrate_to_amm') || 
        log.includes('MigrateToAmm') || 
        log.includes('complete_bonding_curve')) {
      isGraduation = true;
    }
    
    // Check for pump.swap AMM program
    if (log.includes('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA')) {
      migrationProgram = 'pump.swap';
    }
    
    // Try to extract mint from logs
    const mintMatch = log.match(/mint.*?([1-9A-HJ-NP-Za-km-z]{43,44})/i);
    if (mintMatch) {
      mintAddress = mintMatch[1];
    }
  }
  
  return { isGraduation, mintAddress, migrationProgram };
}