/**
 * Parser Error Suppressor
 * Comprehensive error suppression for parser warnings and known errors
 */

export interface ErrorSuppressionConfig {
  suppressParserWarnings?: boolean;
  suppressComputeBudget?: boolean;
  suppressUnknownPrograms?: boolean;
  suppressIDLMismatch?: boolean;
  logSuppressionStats?: boolean;
}

export class ParserErrorSuppressor {
  private originalConsoleWarn: typeof console.warn;
  private originalConsoleError: typeof console.error;
  private suppressionStats = {
    parserWarnings: 0,
    computeBudget: 0,
    unknownPrograms: 0,
    idlMismatch: 0,
    other: 0
  };
  private config: ErrorSuppressionConfig;

  constructor(config: ErrorSuppressionConfig = {}) {
    this.config = {
      suppressParserWarnings: true,
      suppressComputeBudget: true,
      suppressUnknownPrograms: true,
      suppressIDLMismatch: true,
      logSuppressionStats: false,
      ...config
    };

    this.originalConsoleWarn = console.warn;
    this.originalConsoleError = console.error;
  }

  /**
   * Enable error suppression
   */
  enable(): void {
    // Override console.warn
    console.warn = (message?: any, ...optionalParams: any[]) => {
      if (this.shouldSuppress('warn', message)) {
        this.trackSuppression(message);
        return;
      }
      this.originalConsoleWarn(message, ...optionalParams);
    };

    // Override console.error
    console.error = (message?: any, ...optionalParams: any[]) => {
      if (this.shouldSuppress('error', message)) {
        this.trackSuppression(message);
        return;
      }
      this.originalConsoleError(message, ...optionalParams);
    };
  }

  /**
   * Disable error suppression
   */
  disable(): void {
    console.warn = this.originalConsoleWarn;
    console.error = this.originalConsoleError;
    
    if (this.config.logSuppressionStats) {
      this.logStats();
    }
  }

  /**
   * Check if a message should be suppressed
   */
  private shouldSuppress(_level: 'warn' | 'error', message: any): boolean {
    if (typeof message !== 'string') return false;

    // Parser warnings
    if (this.config.suppressParserWarnings && (
      message.includes('Parser does not matching the instruction args') ||
      message.includes('Failed to parse instruction') ||
      message.includes('Unknown instruction')
    )) {
      return true;
    }

    // ComputeBudget warnings
    if (this.config.suppressComputeBudget && (
      message.includes('ComputeBudget') ||
      message.includes('compute budget') ||
      message.includes('SetComputeUnitLimit') ||
      message.includes('SetComputeUnitPrice')
    )) {
      return true;
    }

    // Unknown program warnings
    if (this.config.suppressUnknownPrograms && (
      message.includes('Unknown program') ||
      message.includes('Program not found') ||
      message.includes('No parser for program')
    )) {
      return true;
    }

    // IDL mismatch warnings
    if (this.config.suppressIDLMismatch && (
      message.includes('IDL mismatch') ||
      message.includes('Anchor version mismatch') ||
      message.includes('Invalid account discriminator')
    )) {
      return true;
    }

    return false;
  }

  /**
   * Track suppression statistics
   */
  private trackSuppression(message: string): void {
    if (message.includes('Parser does not matching') || message.includes('Failed to parse')) {
      this.suppressionStats.parserWarnings++;
    } else if (message.includes('ComputeBudget')) {
      this.suppressionStats.computeBudget++;
    } else if (message.includes('Unknown program')) {
      this.suppressionStats.unknownPrograms++;
    } else if (message.includes('IDL mismatch')) {
      this.suppressionStats.idlMismatch++;
    } else {
      this.suppressionStats.other++;
    }
  }

  /**
   * Get suppression statistics
   */
  getStats() {
    return { ...this.suppressionStats };
  }

  /**
   * Log suppression statistics
   */
  logStats(): void {
    const total = Object.values(this.suppressionStats).reduce((a, b) => a + b, 0);
    if (total > 0) {
      console.log('Parser Error Suppression Stats:');
      console.log(`  Parser warnings: ${this.suppressionStats.parserWarnings}`);
      console.log(`  ComputeBudget: ${this.suppressionStats.computeBudget}`);
      console.log(`  Unknown programs: ${this.suppressionStats.unknownPrograms}`);
      console.log(`  IDL mismatches: ${this.suppressionStats.idlMismatch}`);
      console.log(`  Other: ${this.suppressionStats.other}`);
      console.log(`  Total suppressed: ${total}`);
    }
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.suppressionStats = {
      parserWarnings: 0,
      computeBudget: 0,
      unknownPrograms: 0,
      idlMismatch: 0,
      other: 0
    };
  }
}

// Singleton instance
let suppressorInstance: ParserErrorSuppressor | null = null;

/**
 * Get or create the singleton suppressor instance
 */
export function getErrorSuppressor(config?: ErrorSuppressionConfig): ParserErrorSuppressor {
  if (!suppressorInstance) {
    suppressorInstance = new ParserErrorSuppressor(config);
  }
  return suppressorInstance;
}

/**
 * Enable error suppression globally
 */
export function enableErrorSuppression(config?: ErrorSuppressionConfig): void {
  const suppressor = getErrorSuppressor(config);
  suppressor.enable();
}

/**
 * Disable error suppression globally
 */
export function disableErrorSuppression(): void {
  if (suppressorInstance) {
    suppressorInstance.disable();
  }
}