/**
 * Mock Services for Testing
 * Provides mock implementations of core services
 */

import { DatabaseService } from '../../src/database/database-service';

export class MockDatabaseService implements Partial<DatabaseService> {
  private data: Map<string, any[]> = new Map();
  private queryHistory: Array<{ sql: string; params: any[]; timestamp: Date }> = [];

  constructor() {
    this.reset();
  }

  async query(sql: string, params: any[] = []): Promise<any> {
    this.queryHistory.push({ sql, params, timestamp: new Date() });

    // Simple mock implementation
    if (sql.includes('INSERT INTO tokens_unified')) {
      const mintAddress = params[0];
      const tokens = this.data.get('tokens') || [];
      tokens.push({
        mint_address: mintAddress,
        symbol: params[1],
        name: params[2],
        created_at: new Date()
      });
      this.data.set('tokens', tokens);
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('SELECT * FROM tokens_unified')) {
      const tokens = this.data.get('tokens') || [];
      const mintAddress = params[0];
      const found = tokens.filter(t => t.mint_address === mintAddress);
      return { rows: found, rowCount: found.length };
    }

    if (sql.includes('INSERT INTO trades_unified')) {
      const trades = this.data.get('trades') || [];
      trades.push({
        signature: params[0],
        mint_address: params[1],
        program: params[2],
        trade_type: params[3],
        created_at: new Date()
      });
      this.data.set('trades', trades);
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('SELECT COUNT(*)')) {
      const table = sql.match(/FROM (\w+)/)?.[1];
      const data = this.data.get(table || '') || [];
      return { rows: [{ count: data.length }], rowCount: 1 };
    }

    // Default response
    return { rows: [], rowCount: 0 };
  }

  async batchInsert(table: string, records: any[]): Promise<void> {
    const existing = this.data.get(table) || [];
    this.data.set(table, [...existing, ...records]);
  }

  reset(): void {
    this.data.clear();
    this.queryHistory = [];
    
    // Initialize with empty tables
    this.data.set('tokens', []);
    this.data.set('trades', []);
    this.data.set('mev_events', []);
  }

  getQueryHistory(): Array<{ sql: string; params: any[] }> {
    return this.queryHistory;
  }

  getTableData(table: string): any[] {
    return this.data.get(table) || [];
  }

  setTableData(table: string, data: any[]): void {
    this.data.set(table, data);
  }
}

export class MockStreamClient {
  private connected: boolean = false;
  private subscribers: Map<string, (data: any) => void> = new Map();

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  subscribe(config: any, callback: (data: any) => void): string {
    const id = Math.random().toString(36).substr(2, 9);
    this.subscribers.set(id, callback);
    return id;
  }

  unsubscribe(id: string): void {
    this.subscribers.delete(id);
  }

  sendMockData(data: any): void {
    if (!this.connected) return;
    
    for (const callback of this.subscribers.values()) {
      callback(data);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export class MockSolPriceService {
  private price: number = 100;
  private priceHistory: Array<{ price: number; timestamp: Date }> = [];

  async getSolPrice(): Promise<number> {
    this.priceHistory.push({ price: this.price, timestamp: new Date() });
    return this.price;
  }

  setPrice(price: number): void {
    this.price = price;
  }

  getPriceHistory(): Array<{ price: number; timestamp: Date }> {
    return this.priceHistory;
  }

  startPriceUpdates(): void {
    // No-op for testing
  }

  stopPriceUpdates(): void {
    // No-op for testing
  }
}

export class MockMetadataEnricher {
  private metadata: Map<string, any> = new Map();

  async enrichToken(mintAddress: string): Promise<any> {
    return this.metadata.get(mintAddress) || {
      symbol: 'TEST',
      name: 'Test Token',
      image: 'https://example.com/image.png'
    };
  }

  async enrichTokensBatch(mintAddresses: string[]): Promise<any[]> {
    return mintAddresses.map(mint => this.enrichToken(mint));
  }

  setMetadata(mintAddress: string, metadata: any): void {
    this.metadata.set(mintAddress, metadata);
  }
}

export class MockEventBus {
  private listeners: Map<string, Array<(data: any) => void>> = new Map();
  public emittedEvents: Array<{ event: string; data: any; timestamp: Date }> = [];

  on(event: string, callback: (data: any) => void): void {
    const listeners = this.listeners.get(event) || [];
    listeners.push(callback);
    this.listeners.set(event, listeners);
  }

  emit(event: string, data: any): void {
    this.emittedEvents.push({ event, data, timestamp: new Date() });
    
    // Call specific event listeners
    const listeners = this.listeners.get(event) || [];
    for (const listener of listeners) {
      listener(data);
    }
    
    // Call wildcard listeners
    const wildcardListeners = this.listeners.get('*') || [];
    for (const listener of wildcardListeners) {
      listener({ event, data });
    }
  }

  removeListener(event: string, callback: (data: any) => void): void {
    const listeners = this.listeners.get(event) || [];
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  getEmittedEvents(eventName?: string): any[] {
    if (!eventName) {
      return this.emittedEvents;
    }
    
    return this.emittedEvents
      .filter(e => e.event === eventName)
      .map(e => e.data);
  }

  clearEmittedEvents(): void {
    this.emittedEvents = [];
  }
}

export class MockLogger {
  public logs: Array<{ level: string; message: string; context?: any; timestamp: Date }> = [];

  log(level: string, message: string, context?: any): void {
    this.logs.push({ level, message, context, timestamp: new Date() });
  }

  info(message: string, context?: any): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: any): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error | any, context?: any): void {
    this.log('error', message, { error, ...context });
  }

  debug(message: string, context?: any): void {
    this.log('debug', message, context);
  }

  getLogs(level?: string): any[] {
    if (!level) {
      return this.logs;
    }
    return this.logs.filter(l => l.level === level);
  }

  clearLogs(): void {
    this.logs = [];
  }
}