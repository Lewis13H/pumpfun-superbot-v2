import { PumpMonitor } from './monitor';
import { MetadataFetcher } from './metadata';
import { DashboardServer } from './websocket';
import { pool } from './database';
import * as cron from 'node-cron';

async function main() {
  // Test database connection
  await pool.query('SELECT NOW()');
  console.log('✅ Database connected');

  // Initialize services
  const monitor = new PumpMonitor();
  const metadata = new MetadataFetcher();
  const dashboard = new DashboardServer();

  // Handle new tokens
  monitor.on('token:new', (token) => {
    console.log(`🚀 New token: ${token.address}`);
    metadata.queueToken(token);
    dashboard.broadcastNewToken(token);
  });

  // Handle price updates
  monitor.on('flush', ({ count }) => {
    console.log(`💾 Flushed ${count} price updates`);
    dashboard.broadcastPriceUpdate(count);
  });

  // Handle errors
  monitor.on('error', (error) => {
    console.error('Monitor error:', error);
  });

  // Start monitoring
  await monitor.start();

  // Archive tokens under $15k every hour
  cron.schedule('0 * * * *', async () => {
    const result = await pool.query(`
      UPDATE tokens t
      SET archived = true, archived_at = NOW()
      FROM (
        SELECT token, MAX(market_cap_usd) as max_mcap
        FROM price_updates
        WHERE time > NOW() - INTERVAL '24 hours'
        GROUP BY token
        HAVING MAX(market_cap_usd) < $1
      ) p
      WHERE t.address = p.token
      AND NOT t.archived
      AND t.created_at < NOW() - INTERVAL '24 hours'
    `, [15000]);
    
    console.log(`📦 Archived ${result.rowCount} low-value tokens`);
  });

  // Update dashboard every 10 seconds
  setInterval(() => dashboard.sendActiveTokens(), 10000);

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await monitor.stop();
    await pool.end();
    process.exit(0);
  });
}

main().catch(console.error);