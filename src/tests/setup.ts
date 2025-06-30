/**
 * Jest test setup
 */

// Increase timeout for integration tests
jest.setTimeout(15000);

// Mock console methods to reduce noise
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error
};

beforeAll(() => {
  // Suppress console output during tests unless DEBUG=true
  if (!process.env.DEBUG) {
    console.log = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
    // Keep error output
  }
});

afterAll(() => {
  // Restore console
  Object.assign(console, originalConsole);
});

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test@localhost:5432/test';
process.env.SHYFT_GRPC_ENDPOINT = process.env.SHYFT_GRPC_ENDPOINT || 'https://test.grpc.endpoint';
process.env.SHYFT_GRPC_TOKEN = process.env.SHYFT_GRPC_TOKEN || 'test-token';

// Global test utilities
global.waitFor = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));