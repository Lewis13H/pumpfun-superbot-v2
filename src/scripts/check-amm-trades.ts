import { UnifiedDBService } from '../database/unified-db-service';
import { performanceMonitor } from '../services/monitoring/performance-monitor';
import { Pool } from 'pg';

async function main() {
  // Get monitor stats
  const monitors = performanceMonitor.getCurrentMetrics().monitors;
  console.log('Monitor Stats:');
  monitors.forEach(m => {
    if (m.name.includes('Trading') || m.name.includes('AMM') || m.name.includes('Liquidity')) {
      console.log(`${m.name}: ${m.messagesPerSecond} msg/s, parse rate: ${m.parseRate}%`);
    }
  });

  // Check database for recent AMM trades
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  const db = new UnifiedDBService(pool);

  const result = await db.query(`
    SELECT COUNT(*) as count, program, MIN(block_time) as oldest, MAX(block_time) as newest
    FROM trades_unified 
    WHERE block_time > NOW() - INTERVAL '10 minutes'
    GROUP BY program
  `);

  console.log('\nRecent trades by program:');
  console.table(result.rows);

  // Check for pump AMM transactions
  const ammResult = await db.query(`
    SELECT signature, mint_address, trade_type, volume_usd, block_time
    FROM trades_unified 
    WHERE program = 'amm_pool'
    AND block_time > NOW() - INTERVAL '1 hour'
    ORDER BY block_time DESC
    LIMIT 10
  `);

  console.log('\nRecent AMM trades:');
  console.table(ammResult.rows);

  // Check if we're getting any pump AMM transactions in logs
  const logsResult = await db.query(`
    SELECT COUNT(*) as log_count
    FROM pg_stat_activity
    WHERE query LIKE '%amm_pool%'
    AND query_start > NOW() - INTERVAL '5 minutes'
  `);

  console.log('\nRecent AMM-related queries:', logsResult.rows[0]?.log_count || 0);

  await pool.end();
  process.exit(0);
}

main().catch(console.error);