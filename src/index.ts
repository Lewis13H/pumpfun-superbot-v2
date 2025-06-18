import { PumpMonitor } from './monitor';
import { MetadataFetcher } from './metadata';
import { DashboardServer } from './websocket';
import { WebServer } from './webserver';
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
  const webServer = new WebServer();

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
    
    // Queue for metadata fetch
    metadata.enqueue(token.address);
  });

  // Handle metadata fetched event (if metadata extends EventEmitter)
  metadata.on('metadata:fetched', async (data) => {
    // Get the updated token data and broadcast it
    const tokenResult = await pool.query(`
      SELECT 
        t.*,
        p.price_usd as current_price,
        p.market_cap_usd as current_mcap,
        p.liquidity_usd as current_liquidity
      FROM tokens t
      LEFT JOIN LATERAL (
        SELECT * FROM price_updates 
        WHERE token = t.address 
        ORDER BY time DESC 
        LIMIT 1
      ) p ON true
      WHERE t.address = $1
    `, [data.address]);

    if (tokenResult.rows.length > 0) {
      dashboard.broadcastNewToken(tokenResult.rows[0]);
    }
  });

  // Handle milestone events
  monitor.on('milestone', (data) => {
    dashboard.broadcast({
      type: 'milestone',
      data
    });
  });

  // Handle graduation events
  monitor.on('graduated', async (data) => {
    console.log(`🎓 Token graduated: ${data.token}`);
    
    // Update database
    await pool.query(
      'UPDATE tokens SET graduated = true WHERE address = $1',
      [data.token]
    );
    
    dashboard.broadcast({
      type: 'graduated',
      data
    });
  });

  // Handle flush events with actual price updates
  monitor.on('flush', async (data) => {
    // Broadcast price updates to subscribed clients
    if (data.updates) {
      await dashboard.broadcastPriceUpdate(data.updates);
    }
    
    // Also broadcast general stats
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

  // Start monitor in background (it runs forever)
  monitor.start().catch(console.error);
  console.log('✅ Monitor started (running in background)');

  // Start other services that return immediately
  console.log('Starting dashboard...');
  await dashboard.start();
  
  console.log('Starting web server...');
  await webServer.start(config.web?.port || 3000);
  
  console.log('✅ All services started!');

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
      
      if ((result.rowCount ?? 0) > 0) {
        console.log(`📦 Archived ${result.rowCount} low-value tokens`);
        
        // Refresh dashboard after archiving
        await dashboard.sendActiveTokens();
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
    await webServer.stop();
    await pool.end();
    process.exit(0);
  });
}

main().catch(console.error);