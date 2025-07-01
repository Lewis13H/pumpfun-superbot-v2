/**
 * Base Repository
 * Provides common database operations
 */

import { Pool, PoolClient } from 'pg';
import { Logger } from '../core/logger';

export abstract class BaseRepository<T> {
  protected pool: Pool;
  protected logger: Logger;
  protected tableName: string;

  constructor(pool: Pool, tableName: string, context: string) {
    this.pool = pool;
    this.tableName = tableName;
    this.logger = new Logger({ context });
  }

  /**
   * Execute a query
   */
  protected async query<R = any>(
    text: string, 
    params?: any[]
  ): Promise<R[]> {
    try {
      const result = await this.pool.query(text, params);
      return result.rows;
    } catch (error) {
      // Don't log duplicate key errors - they're often expected
      if (!(error as any).message?.includes('duplicate key value violates unique constraint')) {
        this.logger.error('Query failed', error as Error, { text, params });
      }
      throw error;
    }
  }

  /**
   * Execute a query with a single result
   */
  protected async queryOne<R = any>(
    text: string,
    params?: any[]
  ): Promise<R | null> {
    const rows = await this.query<R>(text, params);
    return rows[0] || null;
  }

  /**
   * Execute a query in a transaction
   */
  protected async transaction<R>(
    callback: (client: PoolClient) => Promise<R>
  ): Promise<R> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Batch insert with ON CONFLICT handling
   */
  protected async batchInsert(
    items: T[],
    columns: string[],
    onConflict: string,
    returning?: string
  ): Promise<any[]> {
    if (items.length === 0) return [];

    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    // Build placeholders and flatten values
    for (const item of items) {
      const rowPlaceholders: string[] = [];
      for (const col of columns) {
        values.push((item as any)[col]);
        rowPlaceholders.push(`$${paramIndex++}`);
      }
      placeholders.push(`(${rowPlaceholders.join(', ')})`);
    }

    const query = `
      INSERT INTO ${this.tableName} (${columns.join(', ')})
      VALUES ${placeholders.join(', ')}
      ${onConflict}
      ${returning ? `RETURNING ${returning}` : ''}
    `;

    return this.query(query, values);
  }

  /**
   * Count records
   */
  async count(where?: string, params?: any[]): Promise<number> {
    const query = `SELECT COUNT(*) as count FROM ${this.tableName} ${where || ''}`;
    const result = await this.queryOne<{ count: string }>(query, params);
    return parseInt(result?.count || '0', 10);
  }

  /**
   * Check if record exists
   */
  async exists(where: string, params: any[]): Promise<boolean> {
    const count = await this.count(`WHERE ${where}`, params);
    return count > 0;
  }

  /**
   * Delete records
   */
  async delete(where: string, params: any[]): Promise<number> {
    const query = `DELETE FROM ${this.tableName} WHERE ${where}`;
    const result = await this.pool.query(query, params);
    return result.rowCount || 0;
  }

  /**
   * Format timestamp for PostgreSQL
   */
  protected formatTimestamp(timestamp?: number | Date): string {
    if (!timestamp) return 'NOW()';
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    return `'${date.toISOString()}'`;
  }

  /**
   * Build WHERE clause from conditions
   */
  protected buildWhereClause(
    conditions: Record<string, any>
  ): { where: string; params: any[] } {
    const clauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(conditions)) {
      if (value === null) {
        clauses.push(`${key} IS NULL`);
      } else if (Array.isArray(value)) {
        const placeholders = value.map(() => `$${paramIndex++}`).join(', ');
        clauses.push(`${key} IN (${placeholders})`);
        params.push(...value);
      } else {
        clauses.push(`${key} = $${paramIndex++}`);
        params.push(value);
      }
    }

    return {
      where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
      params
    };
  }
}