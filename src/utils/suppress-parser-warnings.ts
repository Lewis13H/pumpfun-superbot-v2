/**
 * Suppress parser warnings for ComputeBudget program
 * 
 * The SolanaParser logs warnings for programs it doesn't recognize,
 * including the ComputeBudget program which is harmless.
 */

// Store original console methods
const originalWarn = console.warn;
const originalError = console.error;

// List of programs to ignore warnings for
const IGNORE_PROGRAMS = [
  'ComputeBudget111111111111111111111111111111',
  '11111111111111111111111111111111' // System program
];

/**
 * Override console.warn and console.error to filter out parser warnings
 */
export function suppressParserWarnings() {
  // Override console.warn
  console.warn = (...args: any[]) => {
    const message = args.join(' ');
    
    // Check if this is a parser warning we want to ignore
    if (message.includes('Parser does not matching the instruction args')) {
      for (const program of IGNORE_PROGRAMS) {
        if (message.includes(program)) {
          return; // Suppress this warning
        }
      }
    }
    
    // Otherwise, call original warn
    originalWarn.apply(console, args);
  };

  // Override console.error (parser uses this for the same warning)
  console.error = (...args: any[]) => {
    const message = args.join(' ');
    
    // Check if this is a parser error we want to ignore
    if (message.includes('Parser does not matching the instruction args')) {
      for (const program of IGNORE_PROGRAMS) {
        if (message.includes(program)) {
          return; // Suppress this error
        }
      }
    }
    
    // Otherwise, call original error
    originalError.apply(console, args);
  };
}

/**
 * Restore original console methods
 */
export function restoreConsoleWarnings() {
  console.warn = originalWarn;
  console.error = originalError;
}