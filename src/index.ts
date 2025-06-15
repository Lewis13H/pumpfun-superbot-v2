import { PumpMonitor } from './monitor';
import { MetadataFetcher } from './metadata';
import { DashboardServer } from './websocket';
import { db, pool } from './database';
import { config } from './config';

async function main() {
  // Check database connection
  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connected');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }

  // Initialize services
  const monitor = new PumpMonitor();
  const metadata = new MetadataFetcher();
  const dashboard = new DashboardServer();

  // Handle new tokens
  monitor.on('token:new', async (token) => {
    console.log(`🚀 New token: ${token.address}`);
    
    // Save to database
    await db.upsertToken(
      {
        address: token.address,
        bondingCurve: token.bondingCurve,
      },
      token.timestamp,
      token.creator,
      token.signature
    );
    
    // Queue for metadata fetch (FIXED: use enqueue, not queueToken)
    metadata.enqueue(token.address);
    
    // Notify dashboard
    dashboard.broadcast({
      type: 'token:new',
      data: token
    });
  });

  // Handle milestone events
  monitor.on('milestone', (data) => {
    dashboard.broadcast({
      type: 'milestone',
      data
    });
  });

  // Handle graduation events
  monitor.on('graduated', (data) => {
    console.log(`🎓 Token graduated: ${data.token}`);
    dashboard.broadcast({
      type: 'graduated',
      data
    });
  });

  // Handle flush events
  monitor.on('flush', (data) => {
    dashboard.broadcast({
      type: 'stats',
      data: {
        priceUpdates: data.count,
        ...monitor.getStats()
      }
    });
  });

  // Handle errors
  monitor.on('error', (error) => {
    console.error('Monitor error:', error);
  });

  // Start services
  await monitor.start();
  await dashboard.start();

  // Update dashboard periodically
  setInterval(async () => {
    await dashboard.sendActiveTokens();
  }, 10000);

  // Archive old tokens hourly
  setInterval(async () => {
    try {
      const result = await pool.query(`
        UPDATE tokens 
        SET archived = true 
        WHERE NOT archived 
        AND NOT graduated
        AND created_at < NOW() - INTERVAL '24 hours'
        AND address IN (
          SELECT t.address 
          FROM tokens t
          LEFT JOIN LATERAL (
            SELECT market_cap_usd 
            FROM price_updates 
            WHERE token = t.address 
            ORDER BY time DESC 
            LIMIT 1
          ) p ON true
          WHERE p.market_cap_usd < $1 OR p.market_cap_usd IS NULL
        )
        RETURNING address
      `, [config.monitoring.archiveThreshold]);
      
      if (result.rowCount > 0) {
        console.log(`📦 Archived ${result.rowCount} low-value tokens`);
      }
    } catch (error) {
      console.error('Error archiving tokens:', error);
    }
  }, 3600000); // Every hour

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await monitor.stop();
    await dashboard.stop();
    await pool.end();
    process.exit(0);
  });
}

main().catch(console.error);