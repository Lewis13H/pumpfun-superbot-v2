import { Pool } from 'pg';
import 'dotenv/config';

// Singleton database pool
class Database {
  private static instance: Database;
  private pool: Pool;
  
  private constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    
    // Handle pool errors
    this.pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });
  }
  
  static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }
  
  getPool(): Pool {
    return this.pool;
  }
  
  async query(text: string, params?: any[]): Promise<any> {
    const start = Date.now();
    try {
      const res = await this.pool.query(text, params);
      const duration = Date.now() - start;
      console.log('Executed query', { text, duration, rows: res.rowCount });
      return res;
    } catch (error) {
      console.error('Database query error:', error);
      throw error;
    }
  }
  
  async close(): Promise<void> {
    await this.pool.end();
  }
}

export const db = Database.getInstance();