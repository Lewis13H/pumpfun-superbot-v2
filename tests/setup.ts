/**
 * Global Test Setup
 * Configure test environment and global mocks
 */

import { TextEncoder, TextDecoder } from 'util';

// Polyfill for Node.js environments
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as any;

// Mock console methods to reduce noise during tests
const originalConsole = { ...console };

beforeAll(() => {
  // Suppress console output during tests unless DEBUG is set
  if (!process.env.DEBUG) {
    console.log = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
    console.debug = jest.fn();
    // Keep error for important messages
    console.error = jest.fn((...args) => {
      // Only show non-suppressed errors
      const message = args.join(' ');
      if (!message.includes('ComputeBudget') && 
          !message.includes('Unknown program') &&
          !message.includes('Parse warning')) {
        originalConsole.error(...args);
      }
    });
  }
});

afterAll(() => {
  // Restore console
  Object.assign(console, originalConsole);
});

// Global test utilities
export const testUtils = {
  /**
   * Wait for a condition to be true
   */
  async waitFor(
    condition: () => boolean | Promise<boolean>,
    timeout: number = 5000,
    interval: number = 100
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    throw new Error('Timeout waiting for condition');
  },

  /**
   * Create a delay
   */
  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Generate a random Solana address
   */
  generateAddress(): string {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let address = '';
    for (let i = 0; i < 44; i++) {
      address += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return address;
  },

  /**
   * Generate a random transaction signature
   */
  generateSignature(): string {
    return Array(88).fill(0)
      .map(() => Math.random().toString(36).charAt(2))
      .join('');
  }
};

// Make test utils globally available
(global as any).testUtils = testUtils;

// Configure Jest
jest.setTimeout(30000); // 30 second default timeout

// Mock external dependencies that might not be available in test
jest.mock('@grpc/grpc-js', () => ({
  credentials: {
    createSsl: jest.fn(),
    combineChannelCredentials: jest.fn()
  },
  Metadata: jest.fn().mockImplementation(() => ({
    add: jest.fn()
  }))
}));

jest.mock('@triton-one/yellowstone-grpc', () => ({
  Client: jest.fn().mockImplementation(() => ({
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    close: jest.fn()
  }))
}));

// Mock database pool for unit tests
jest.mock('pg', () => {
  const mockClient = {
    query: jest.fn(),
    release: jest.fn()
  };
  
  const mockPool = {
    query: jest.fn(),
    connect: jest.fn().mockResolvedValue(mockClient),
    end: jest.fn()
  };
  
  return {
    Pool: jest.fn(() => mockPool)
  };
});

// Environment variables for testing
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test@localhost:5432/pump_monitor_test';
process.env.SHYFT_GRPC_ENDPOINT = 'mock://localhost:9000';
process.env.SHYFT_GRPC_TOKEN = 'test-token';

// Custom Jest matchers
expect.extend({
  toBeValidSolanaAddress(received: string) {
    const valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(received);
    return {
      pass: valid,
      message: () => 
        valid 
          ? `Expected ${received} not to be a valid Solana address`
          : `Expected ${received} to be a valid Solana address`
    };
  },
  
  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling;
    return {
      pass,
      message: () =>
        pass
          ? `Expected ${received} not to be within range ${floor} - ${ceiling}`
          : `Expected ${received} to be within range ${floor} - ${ceiling}`
    };
  },
  
  toBeBigInt(received: any) {
    const pass = typeof received === 'bigint';
    return {
      pass,
      message: () =>
        pass
          ? `Expected ${received} not to be a BigInt`
          : `Expected ${received} to be a BigInt`
    };
  }
});

// TypeScript declarations for custom matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidSolanaAddress(): R;
      toBeWithinRange(floor: number, ceiling: number): R;
      toBeBigInt(): R;
    }
  }
}