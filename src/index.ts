// src/index.ts

import { PumpMonitor } from './monitor';  
import { MetadataFetcher } from './metadata';  
import { DashboardServer } from './websocket';  
import { WebServer } from './webserver';  
import { pool } from './database';  
import { config } from './config';  
import { PriceRefresherService } from './monitor/services/price-refresher';

// Force exit on Ctrl+C if graceful shutdown fails  
let shutdownAttempts = 0;

process.on('SIGINT', () => {  
    shutdownAttempts++;  
      
    if (shutdownAttempts === 1) {  
        console.log('\n⚠️  Shutting down... (Press Ctrl+C again to force quit)');  
          
        // Try graceful shutdown  
        setTimeout(() => {  
            console.log('👋 Exiting...');  
            process.exit(0);  
        }, 1000);  
          
    } else if (shutdownAttempts === 2) {  
        console.log('\n❌ Force quitting...');  
        process.exit(1);  
    }  
});

// Prevent the process from being kept alive by timers  
process.on('SIGTERM', () => {  
    process.exit(0);  
});

// For Windows compatibility  
if (process.platform === 'win32') {  
    const rl = require('readline').createInterface({  
        input: process.stdin,  
        output: process.stdout  
    });

    rl.on('SIGINT', () => {  
        process.emit('SIGINT');  
    });  
}

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

  // Initialize price refresher if enabled  
  let priceRefresher: PriceRefresherService | null = null;  
    
  if (config.priceRefresh?.enabled !== false) {  
    const rpcUrl = config.priceRefresh?.rpcUrl ||   
                   (config.shyft?.apiKey ? `https://rpc.shyft.to?api_key=${config.shyft.apiKey}` : null) ||  
                   'https://api.mainnet-beta.solana.com';  
      
    priceRefresher = new PriceRefresherService(  
      rpcUrl,  
      monitor.getSolPriceService(),  
      {  
        refreshInterval: config.priceRefresh?.interval || 60000,  
        batchSize: config.priceRefresh?.batchSize || 20,  
        maxConcurrent: config.priceRefresh?.maxConcurrent || 5  
      }  
    );

    // Price refresher event handlers  
    priceRefresher.on('refresh:complete', (stats) => {  
      console.log(  
        `📊 Price refresh complete: ${stats.pricesUpdated}/${stats.tokensChecked} updated ` +  
        `in ${(stats.duration/1000).toFixed(1)}s`  
      );  
        
      // Broadcast refresh stats to dashboard  
      dashboard.broadcast({  
        type: 'price_refresh',  
        data: stats  
      });  
    });

    priceRefresher.on('refresh:error', (error) => {  
      console.error('❌ Price refresh error:', error);  
    });  
  }

  // Handle new tokens  
  monitor.on('token:new', async (token) => {  
    console.log(`🆕 New token event: ${token.address}`);  
      
    // The monitor now saves tokens immediately, so we don't need to save here  
    // Just queue for metadata fetching  
    metadata.enqueue(token.address);  
  });

  // Handle metadata fetched event (if metadata extends EventEmitter)  
  metadata.on('metadata:fetched', async (data) => {  
    console.log(`📝 Metadata fetched for ${data.symbol || data.address}`);  
      
    try {  
      // Get updated token data with metadata  
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
    } catch (error) {  
      console.error('Error handling metadata update:', error);  
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

  // Start price refresher if enabled  
  if (priceRefresher) {  
    priceRefresher.start();  
    console.log('✅ Price refresh service started');  
  }

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

  // Add periodic cleanup of failed metadata fetches  
  setInterval(async () => {  
    const status = metadata.getQueueStatus();  
    if (status.failedTokens > 0) {  
      console.log(`📊 Metadata queue status: ${status.queueLength} queued, ${status.failedTokens} failed, ${status.retryingTokens} retrying`);  
    }  
  }, 60000); // Every minute

  // Add price refresher stats logging (FIXED)  
  if (priceRefresher) {  
    setInterval(async () => {  
      const healthCheck = await priceRefresher!.healthCheck();  
      if (healthCheck.status === 'healthy') {  
        console.log(`📊 Price refresh status: ${healthCheck.validTokens} valid tokens, ${healthCheck.invalidTokens} invalid`);  
      }  
    }, 30000); // Every 30 seconds  
  }

  // Graceful shutdown  
  process.on('SIGINT', async () => {  
    console.log('\n🛑 Shutting down...');  
      
    // Stop price refresher first (NEW)  
    if (priceRefresher) {  
      priceRefresher.stop();  
      console.log('✅ Price refresher stopped');  
    }  
      
    await monitor.stop();  
    await dashboard.stop();  
    await webServer.stop();  
    await pool.end();  
    process.exit(0);  
  });  
}

main().catch(console.error);