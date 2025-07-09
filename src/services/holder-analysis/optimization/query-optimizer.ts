import { Pool } from 'pg';
import { logger } from '../../../core/logger';

export interface QueryPlan {
  query: string;
  params: any[];
  estimatedCost: number;
  useIndex?: string;
  parallelScan?: boolean;
}

export interface QueryStats {
  executionTime: number;
  rowsReturned: number;
  planningTime?: number;
  bufferHits?: number;
  bufferMisses?: number;
}

export class QueryOptimizer {
  private queryStats = new Map<string, QueryStats[]>();
  private queryPlans = new Map<string, QueryPlan>();
  
  constructor(private pool: Pool) {}
  
  async optimizeHolderQuery(
    mintAddress: string,
    options: {
      includeClassifications?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<QueryPlan> {
    const key = `holders:${mintAddress}:${JSON.stringify(options)}`;
    
    // Check cached plan
    const cachedPlan = this.queryPlans.get(key);
    if (cachedPlan) {
      return cachedPlan;
    }
    
    // Build optimized query
    const plan = this.buildHolderQueryPlan(mintAddress, options);
    this.queryPlans.set(key, plan);
    
    return plan;
  }
  
  private buildHolderQueryPlan(
    mintAddress: string,
    options: any
  ): QueryPlan {
    let query: string;
    const params: any[] = [mintAddress];
    
    if (options.includeClassifications) {
      // Use JOIN for classifications if needed
      query = `
        SELECT 
          thd.*,
          wc.classification,
          wc.confidence,
          wc.metadata
        FROM token_holder_details thd
        LEFT JOIN wallet_classifications wc 
          ON thd.wallet_address = wc.wallet_address
        WHERE thd.mint_address = $1
        ORDER BY thd.balance DESC
      `;
    } else {
      // Simple query without JOIN
      query = `
        SELECT * FROM token_holder_details
        WHERE mint_address = $1
        ORDER BY balance DESC
      `;
    }
    
    if (options.limit) {
      query += ` LIMIT $${params.length + 1}`;
      params.push(options.limit);
    }
    
    if (options.offset) {
      query += ` OFFSET $${params.length + 1}`;
      params.push(options.offset);
    }
    
    return {
      query,
      params,
      estimatedCost: options.includeClassifications ? 2 : 1,
      useIndex: 'idx_token_holder_details_mint_balance'
    };
  }
  
  async optimizeSnapshotQuery(
    mintAddress: string,
    timeRange?: { start: Date; end: Date }
  ): Promise<QueryPlan> {
    let query = `
      SELECT * FROM holder_snapshots
      WHERE mint_address = $1
    `;
    const params: any[] = [mintAddress];
    
    if (timeRange) {
      query += ` AND snapshot_time BETWEEN $2 AND $3`;
      params.push(timeRange.start, timeRange.end);
    }
    
    query += ` ORDER BY snapshot_time DESC`;
    
    return {
      query,
      params,
      estimatedCost: 1,
      useIndex: 'idx_holder_snapshots_mint_time'
    };
  }
  
  async executeWithStats<T>(
    plan: QueryPlan,
    queryKey?: string
  ): Promise<{ rows: T[]; stats: QueryStats }> {
    const startTime = Date.now();
    
    try {
      // Execute with EXPLAIN ANALYZE in development
      const explainQuery = process.env.NODE_ENV === 'development' 
        ? `EXPLAIN (ANALYZE, BUFFERS) ${plan.query}`
        : plan.query;
      
      const result = await this.pool.query(plan.query, plan.params);
      const executionTime = Date.now() - startTime;
      
      const stats: QueryStats = {
        executionTime,
        rowsReturned: result.rows.length
      };
      
      // Store stats for analysis
      if (queryKey) {
        const existing = this.queryStats.get(queryKey) || [];
        existing.push(stats);
        
        // Keep last 100 executions
        if (existing.length > 100) {
          existing.shift();
        }
        
        this.queryStats.set(queryKey, existing);
      }
      
      return {
        rows: result.rows,
        stats
      };
      
    } catch (error) {
      logger.error('Query execution failed:', error);
      throw error;
    }
  }
  
  async createIndexes(): Promise<void> {
    const indexes = [
      // Token holder details indexes
      {
        name: 'idx_token_holder_details_mint_balance',
        table: 'token_holder_details',
        columns: ['mint_address', 'balance DESC']
      },
      {
        name: 'idx_token_holder_details_wallet',
        table: 'token_holder_details',
        columns: ['wallet_address']
      },
      
      // Holder snapshots indexes
      {
        name: 'idx_holder_snapshots_mint_time',
        table: 'holder_snapshots',
        columns: ['mint_address', 'snapshot_time DESC']
      },
      {
        name: 'idx_holder_snapshots_score',
        table: 'holder_snapshots',
        columns: ['holder_score DESC']
      },
      
      // Wallet classifications indexes
      {
        name: 'idx_wallet_classifications_wallet',
        table: 'wallet_classifications',
        columns: ['wallet_address']
      },
      {
        name: 'idx_wallet_classifications_type',
        table: 'wallet_classifications',
        columns: ['classification']
      },
      
      // Holder trends indexes
      {
        name: 'idx_holder_trends_mint_window',
        table: 'holder_trends',
        columns: ['mint_address', 'time_window', 'calculated_at DESC']
      },
      
      // Holder alerts indexes
      {
        name: 'idx_holder_alerts_mint',
        table: 'holder_alerts',
        columns: ['mint_address', 'triggered_at DESC']
      },
      {
        name: 'idx_holder_alerts_acknowledged',
        table: 'holder_alerts',
        columns: ['acknowledged', 'triggered_at DESC']
      }
    ];
    
    for (const index of indexes) {
      try {
        const createQuery = `
          CREATE INDEX IF NOT EXISTS ${index.name}
          ON ${index.table} (${index.columns.join(', ')})
        `;
        
        await this.pool.query(createQuery);
        logger.info(`Created/verified index: ${index.name}`);
        
      } catch (error) {
        logger.error(`Failed to create index ${index.name}:`, error);
      }
    }
  }
  
  async analyzePerformance(): Promise<{
    slowQueries: Array<{ key: string; avgTime: number; count: number }>;
    recommendations: string[];
  }> {
    const slowQueries: Array<{ key: string; avgTime: number; count: number }> = [];
    const recommendations: string[] = [];
    
    // Analyze query stats
    for (const [key, stats] of this.queryStats.entries()) {
      const avgTime = stats.reduce((sum, s) => sum + s.executionTime, 0) / stats.length;
      
      if (avgTime > 1000) { // Queries taking more than 1 second
        slowQueries.push({
          key,
          avgTime,
          count: stats.length
        });
      }
    }
    
    // Generate recommendations
    if (slowQueries.length > 0) {
      recommendations.push('Consider adding indexes for frequently accessed columns');
      recommendations.push('Review query patterns and consider denormalization for complex JOINs');
    }
    
    // Check for missing indexes
    const missingIndexes = await this.checkMissingIndexes();
    if (missingIndexes.length > 0) {
      recommendations.push(`Create missing indexes: ${missingIndexes.join(', ')}`);
    }
    
    return {
      slowQueries: slowQueries.sort((a, b) => b.avgTime - a.avgTime),
      recommendations
    };
  }
  
  private async checkMissingIndexes(): Promise<string[]> {
    const missing: string[] = [];
    
    try {
      // Check for indexes on foreign key columns
      const query = `
        SELECT 
          tc.table_name,
          kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE tablename = tc.table_name
              AND indexdef LIKE '%' || kcu.column_name || '%'
          )
      `;
      
      const result = await this.pool.query(query);
      
      for (const row of result.rows) {
        missing.push(`${row.table_name}.${row.column_name}`);
      }
      
    } catch (error) {
      logger.error('Failed to check missing indexes:', error);
    }
    
    return missing;
  }
  
  getQueryStats(): Map<string, QueryStats[]> {
    return this.queryStats;
  }
}