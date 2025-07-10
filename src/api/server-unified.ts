import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { Pool } from 'pg';
import { createServer } from 'http';
// import { bcWebSocketServer } from '../services/bc-websocket-server'; // File deleted
// import { unifiedWebSocketServer } from '../services/unified-websocket-server-fixed';
// const WebSocket = require('ws'); // Not used
// import bcMonitorEndpoints from './bc-monitor-endpoints'; // Legacy - removed with smart streaming
import { registerPerformanceEndpoints } from './performance-metrics-endpoints';
import { createStaleTokenEndpoints } from './stale-token-endpoints';
import { RealtimePriceCache } from '../services/pricing/realtime-price-cache';
import { setupNewEndpoints } from './setup-new-endpoints';
import { createHolderAnalysisRoutes } from './routes/holder-analysis-routes';
import { createHolderAnalysisHistoricalRoutes } from './holder-analysis-historical-routes';
import { createParsingMetricsRoutes } from './routes/parsing-metrics.routes';

const app = express();
const PORT = process.env.API_PORT || 3001;
const server = createServer(app);

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Initialize WebSocket servers BEFORE middleware
// bcWebSocketServer.initialize(server); // Keep BC WebSocket for backward compatibility - COMMENTED: File deleted

// Unified WebSocket disabled - using mock BC WebSocket for dashboard compatibility

// Create a mock unifiedWebSocketServer for monitors that expect it
(global as any).unifiedWebSocketServer = {
  broadcast: (_message: any) => {
    // No-op - WebSocket disabled
  },
  broadcastTrade: (_trade: any, _source: string = 'bc') => {
    // No-op - WebSocket disabled
  },
  broadcastGraduation: (_graduation: any) => {
    // No-op - WebSocket disabled
  },
  broadcastNewToken: (_token: any, _source: string = 'bc') => {
    // No-op - WebSocket disabled
  },
  broadcastPoolStateChange: (_poolState: any) => {
    // No-op - WebSocket disabled
  },
  broadcastStats: (_stats: any, _source: string) => {
    // No-op - WebSocket disabled
  },
  getClientCount: () => 0
};

// Middleware
app.use(cors());
app.use(express.json());

// Serve static dashboard files
app.use(express.static(path.join(__dirname, '../../dashboard')));

// BC Monitor API endpoints
// app.use('/api/bc-monitor', bcMonitorEndpoints); // Legacy - removed with smart streaming


// Stale token monitoring endpoints
app.use('/api/stale', createStaleTokenEndpoints(pool));

// Register performance monitoring endpoints
registerPerformanceEndpoints(app);

// Register new fault tolerance and performance optimization endpoints
setupNewEndpoints(app).catch(console.error);

// Register holder analysis endpoints
app.use('/api', createHolderAnalysisRoutes(pool));

// Register holder analysis historical endpoints
app.use('/api/v1', createHolderAnalysisHistoricalRoutes(pool));

// Register parsing metrics endpoints
app.use('/', createParsingMetricsRoutes());

// Get realtime price cache instance
const realtimePriceCache = RealtimePriceCache.getInstance();

// API endpoint for tokens - unified schema
app.get('/api/tokens', async (_req, res) => {
  try {
    const query = `
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.image_uri,
        t.creator,
        t.first_seen_at,
        t.token_created_at,
        t.first_program,
        t.current_program,
        t.graduated_to_amm,
        t.threshold_crossed_at,
        t.latest_price_sol,
        t.latest_price_usd,
        t.latest_market_cap_usd,
        t.latest_bonding_curve_progress,
        t.bonding_curve_complete,
        t.volume_24h_usd,
        t.holder_count,
        t.top_holder_percentage,
        t.total_trades,
        t.unique_traders_24h,
        -- Calculate age from actual creation time if available, otherwise from first seen
        EXTRACT(EPOCH FROM (NOW() - COALESCE(t.token_created_at, t.first_seen_at))) as age_seconds,
        -- Get SOL price for calculations
        (SELECT price FROM sol_prices ORDER BY created_at DESC LIMIT 1) as sol_price,
        -- Always calculate USD price from SOL price for better precision
        -- The latest_price_usd column only has 4 decimal places which causes issues for small prices
        t.latest_price_sol * (SELECT price FROM sol_prices ORDER BY created_at DESC LIMIT 1) as calculated_price_usd,
        -- Get latest holder score
        (SELECT hs.holder_score 
         FROM holder_snapshots hs 
         WHERE hs.mint_address = t.mint_address 
         ORDER BY hs.snapshot_time DESC 
         LIMIT 1) as holder_score
      FROM tokens_unified t
      WHERE t.threshold_crossed_at IS NOT NULL
      ORDER BY t.latest_market_cap_usd DESC NULLS LAST
    `;
    
    const result = await pool.query(query);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching tokens:', error);
    res.status(500).json({ error: 'Failed to fetch tokens' });
  }
});

// API endpoint for SOL price and system status
app.get('/api/status', async (_req, res) => {
  try {
    // Get latest SOL price
    const priceResult = await pool.query(
      'SELECT price, source, created_at FROM sol_prices ORDER BY created_at DESC LIMIT 1'
    );
    
    // Get system stats
    const statsResult = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM tokens_unified) as total_tokens,
        (SELECT COUNT(*) FROM tokens_unified WHERE graduated_to_amm = true) as graduated_tokens,
        (SELECT COUNT(*) FROM tokens_unified WHERE threshold_crossed_at IS NOT NULL) as tracked_tokens,
        (SELECT COUNT(*) FROM trades_unified WHERE created_at > NOW() - INTERVAL '1 hour') as hourly_trades
    `);
    
    const solPrice = priceResult.rows[0] || { price: 180, source: 'fallback', created_at: new Date() };
    const stats = statsResult.rows[0] || { total_tokens: 0, graduated_tokens: 0, tracked_tokens: 0, hourly_trades: 0 };
    
    // Get monitor connection status if available
    let monitors = null;
    try {
      const appContainer = (global as any).appContainer;
      if (appContainer && appContainer.has('StreamManager')) {
        const streamManager = await appContainer.resolve('StreamManager');
        if (streamManager && typeof streamManager.getConnectionStatus === 'function') {
          const connectionStatus = streamManager.getConnectionStatus();
          monitors = {
            stream_status: connectionStatus.isConnected ? 'connected' : 'disconnected',
            connection_details: connectionStatus
          };
        }
      }
    } catch (monitorError) {
      console.error('Error getting monitor status:', monitorError);
      // Continue without monitor status
    }
    
    // If no monitors data available, provide default structure
    if (!monitors) {
      monitors = {
        stream_status: 'disconnected',
        connection_details: {
          status: 'disconnected',
          isConnected: false,
          messagesReceived: 0,
          lastMessageTime: null
        }
      };
    }
    
    res.json({
      sol_price: {
        price: parseFloat(solPrice.price),
        source: solPrice.source || 'binance',
        timestamp: solPrice.created_at
      },
      stats: {
        total_tokens: parseInt(stats.total_tokens),
        graduated_tokens: parseInt(stats.graduated_tokens),
        tracked_tokens: parseInt(stats.tracked_tokens),
        hourly_trades: parseInt(stats.hourly_trades)
      },
      monitors
    });
  } catch (error) {
    console.error('Error fetching status:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// API endpoint for realtime token prices
app.get('/api/tokens/realtime', async (_req, res) => {
  try {
    // First get tokens from database
    const query = `
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.image_uri,
        t.creator,
        t.first_seen_at,
        t.token_created_at,
        t.first_program,
        t.current_program,
        t.graduated_to_amm,
        t.threshold_crossed_at,
        t.latest_price_sol,
        t.latest_price_usd,
        t.latest_market_cap_usd,
        t.latest_virtual_sol_reserves,
        t.latest_virtual_token_reserves,
        t.latest_bonding_curve_progress,
        t.bonding_curve_complete,
        t.volume_24h_usd,
        t.holder_count,
        t.top_holder_percentage,
        t.total_trades,
        t.unique_traders_24h,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(t.token_created_at, t.first_seen_at))) as age_seconds,
        (SELECT price FROM sol_prices ORDER BY created_at DESC LIMIT 1) as sol_price,
        -- Get latest holder score
        (SELECT hs.holder_score 
         FROM holder_snapshots hs 
         WHERE hs.mint_address = t.mint_address 
         ORDER BY hs.snapshot_time DESC 
         LIMIT 1) as holder_score
      FROM tokens_unified t
      WHERE t.threshold_crossed_at IS NOT NULL
      ORDER BY t.latest_market_cap_usd DESC NULLS LAST
    `;
    
    const result = await pool.query(query);
    
    // Update with realtime prices from cache
    const tokensWithRealtimePrices = result.rows.map(token => {
      const realtimeData = realtimePriceCache.getPrice(token.mint_address);
      
      if (realtimeData) {
        return {
          ...token,
          latest_price_sol: realtimeData.priceSol || token.latest_price_sol,
          latest_price_usd: realtimeData.priceUsd || token.latest_price_usd,
          latest_market_cap_usd: realtimeData.marketCapUsd || token.latest_market_cap_usd,
          latest_bonding_curve_progress: realtimeData.bondingCurveProgress || token.latest_bonding_curve_progress,
          calculated_price_usd: realtimeData.priceUsd || token.calculated_price_usd,
          realtime_updated: true
        };
      }
      
      // Ensure we have valid numbers
      const priceSol = parseFloat(token.latest_price_sol) || 0;
      const solPrice = parseFloat(token.sol_price) || 0;
      const calcPrice = priceSol * solPrice;
      
      return {
        ...token,
        // Always calculate from SOL price for better precision
        calculated_price_usd: calcPrice,
        realtime_updated: false
      };
    });
    
    res.json(tokensWithRealtimePrices);
    
  } catch (error) {
    console.error('Error fetching realtime tokens:', error);
    res.status(500).json({ error: 'Failed to fetch realtime tokens' });
  }
});

// API endpoint for recent trades
app.get('/api/trades/recent', async (_req, res) => {
  try {
    const query = `
      SELECT 
        tr.signature,
        tr.mint_address,
        tr.trade_type,
        tr.sol_amount,
        tr.token_amount,
        tr.price_usd,
        tr.created_at,
        t.symbol,
        t.name
      FROM trades_unified tr
      JOIN tokens_unified t ON tr.mint_address = t.mint_address
      ORDER BY tr.created_at DESC
      LIMIT 50
    `;
    
    const result = await pool.query(query);
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching trades:', error);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

// API endpoint for token details
app.get('/api/tokens/:mintAddress', async (req, res) => {
  try {
    const { mintAddress } = req.params;
    
    const query = `
      SELECT 
        t.*,
        -- Calculate age from actual creation time if available
        EXTRACT(EPOCH FROM (NOW() - COALESCE(t.token_created_at, t.first_seen_at))) as age_seconds,
        -- Get current SOL price
        (SELECT price FROM sol_prices ORDER BY created_at DESC LIMIT 1) as sol_price,
        -- Get recent price history (24h)
        (
          SELECT json_agg(
            json_build_object(
              'created_at', ps.created_at,
              'price_usd', ps.price_usd,
              'price_sol', ps.price_sol,
              'market_cap_usd', ps.market_cap_usd,
              'bonding_curve_progress', ps.bonding_curve_progress,
              'virtual_sol_reserves', ps.virtual_sol_reserves,
              'virtual_token_reserves', ps.virtual_token_reserves
            ) ORDER BY ps.created_at DESC
          )
          FROM price_snapshots_unified ps
          WHERE ps.mint_address = t.mint_address
          AND ps.created_at > NOW() - INTERVAL '24 hours'
          LIMIT 200
        ) as price_history_24h,
        -- Get hourly price snapshots (7 days)
        (
          SELECT json_agg(
            json_build_object(
              'created_at', ps.created_at,
              'price_usd', ps.price_usd,
              'market_cap_usd', ps.market_cap_usd,
              'volume_hour', (
                SELECT COALESCE(SUM(CAST(tr.sol_amount AS DECIMAL) * tr.price_usd / NULLIF(tr.price_sol, 0)), 0)
                FROM trades_unified tr
                WHERE tr.mint_address = ps.mint_address
                AND tr.created_at BETWEEN ps.created_at - INTERVAL '1 hour' AND ps.created_at
              )
            ) ORDER BY ps.created_at DESC
          )
          FROM (
            SELECT DISTINCT ON (date_trunc('hour', created_at))
              mint_address, created_at, price_usd, price_sol, market_cap_usd
            FROM price_snapshots_unified
            WHERE mint_address = t.mint_address
            AND created_at > NOW() - INTERVAL '7 days'
            ORDER BY date_trunc('hour', created_at) DESC, created_at DESC
          ) ps
        ) as price_history_7d,
        -- Get recent trades with user info
        (
          SELECT json_agg(
            json_build_object(
              'signature', tr.signature,
              'trade_type', tr.trade_type,
              'user_address', tr.user_address,
              'price_usd', tr.price_usd,
              'price_sol', tr.price_sol,
              'sol_amount', tr.sol_amount,
              'token_amount', tr.token_amount,
              'market_cap_usd', tr.market_cap_usd,
              'created_at', tr.created_at,
              'block_time', tr.block_time
            ) ORDER BY tr.created_at DESC
          )
          FROM trades_unified tr
          WHERE tr.mint_address = t.mint_address
          LIMIT 50
        ) as recent_trades,
        -- Get trade statistics
        (
          SELECT json_build_object(
            'total_trades', COUNT(*),
            'total_buys', COUNT(*) FILTER (WHERE trade_type = 'buy'),
            'total_sells', COUNT(*) FILTER (WHERE trade_type = 'sell'),
            'unique_traders_24h', COUNT(DISTINCT user_address) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'),
            'unique_traders_total', COUNT(DISTINCT user_address),
            'volume_1h_usd', COALESCE(SUM(CAST(sol_amount AS DECIMAL) * price_usd / NULLIF(price_sol, 0)) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour'), 0),
            'volume_24h_usd', COALESCE(SUM(CAST(sol_amount AS DECIMAL) * price_usd / NULLIF(price_sol, 0)) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'), 0),
            'volume_7d_usd', COALESCE(SUM(CAST(sol_amount AS DECIMAL) * price_usd / NULLIF(price_sol, 0)) FILTER (WHERE created_at > NOW() - INTERVAL '7 days'), 0),
            'volume_total_usd', COALESCE(SUM(CAST(sol_amount AS DECIMAL) * price_usd / NULLIF(price_sol, 0)), 0)
          )
          FROM trades_unified
          WHERE mint_address = t.mint_address
        ) as trade_stats,
        -- Get AMM pool info if graduated
        (
          SELECT json_build_object(
            'pool_address', aps.pool_address,
            'virtual_sol_reserves', aps.virtual_sol_reserves,
            'virtual_token_reserves', aps.virtual_token_reserves,
            'virtual_lp_supply', aps.virtual_lp_supply,
            'swap_fee_numerator', aps.swap_fee_numerator,
            'swap_fee_denominator', aps.swap_fee_denominator,
            'total_volume_sol', aps.total_volume_sol,
            'total_trades', aps.total_trades,
            'last_price_sol', aps.last_price_sol,
            'last_price_usd', aps.last_price_usd,
            'updated_at', aps.updated_at
          )
          FROM amm_pool_state aps
          WHERE aps.mint_address = t.mint_address
          LIMIT 1
        ) as pool_info,
        -- Calculate additional metrics
        CASE 
          WHEN t.first_price_usd > 0 
          THEN ((t.latest_price_usd - t.first_price_usd) / t.first_price_usd) * 100
          ELSE 0 
        END as total_gain_percent,
        CASE 
          WHEN t.graduated_to_amm = true AND t.threshold_price_usd > 0 
          THEN ((t.latest_price_usd - t.threshold_price_usd) / t.threshold_price_usd) * 100
          ELSE 0 
        END as gain_since_graduation
      FROM tokens_unified t
      WHERE t.mint_address = $1
    `;
    
    const result = await pool.query(query, [mintAddress]);
    
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Token not found' });
      return;
    }
    
    res.json(result.rows[0]);
    
  } catch (error) {
    console.error('Error fetching token details:', error);
    res.status(500).json({ error: 'Failed to fetch token details' });
  }
});

// API endpoint for graduated tokens
app.get('/api/tokens/graduated', async (_req, res) => {
  try {
    const query = `
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.graduation_at,
        t.latest_price_usd,
        t.latest_market_cap_usd,
        t.volume_24h_usd,
        -- Calculate gains since graduation
        CASE 
          WHEN t.threshold_price_usd > 0 
          THEN ((t.latest_price_usd - t.threshold_price_usd) / t.threshold_price_usd) * 100
          ELSE 0 
        END as gain_since_graduation
      FROM tokens_unified t
      WHERE t.graduated_to_amm = true
      ORDER BY t.graduation_at DESC
    `;
    
    const result = await pool.query(query);
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching graduated tokens:', error);
    res.status(500).json({ error: 'Failed to fetch graduated tokens' });
  }
});

// API endpoint for tokens near graduation
app.get('/api/tokens/near-graduation', async (_req, res) => {
  try {
    const query = `
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.latest_bonding_curve_progress,
        t.latest_price_usd,
        t.latest_market_cap_usd,
        t.volume_24h_usd,
        t.total_trades
      FROM tokens_unified t
      WHERE t.graduated_to_amm = false
      AND t.latest_bonding_curve_progress >= 90
      ORDER BY t.latest_bonding_curve_progress DESC
    `;
    
    const result = await pool.query(query);
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching near-graduation tokens:', error);
    res.status(500).json({ error: 'Failed to fetch near-graduation tokens' });
  }
});

// Removed duplicate /api/tokens/realtime endpoint - using the first one defined earlier

// API endpoint for testing holder score
app.get('/api/test/holder-score', async (_req, res) => {
  try {
    const query = `
      SELECT 
        t.mint_address,
        t.symbol,
        (SELECT hs.holder_score 
         FROM holder_snapshots hs 
         WHERE hs.mint_address = t.mint_address 
         ORDER BY hs.snapshot_time DESC 
         LIMIT 1) as holder_score
      FROM tokens_unified t
      WHERE t.symbol = 'MINTR'
    `;
    
    const result = await pool.query(query);
    
    console.log('Test endpoint - MINTR holder_score:', result.rows[0]?.holder_score);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error in test endpoint:', error);
    res.status(500).json({ error: 'Failed to test holder score' });
  }
});

// API endpoint for top gainers
app.get('/api/tokens/gainers', async (_req, res) => {
  try {
    const query = `
      WITH price_changes AS (
        SELECT 
          t.mint_address,
          t.symbol,
          t.name,
          t.latest_price_usd,
          t.latest_market_cap_usd,
          t.first_price_usd,
          CASE 
            WHEN t.first_price_usd > 0 
            THEN ((t.latest_price_usd - t.first_price_usd) / t.first_price_usd) * 100
            ELSE 0 
          END as price_change_pct
        FROM tokens_unified t
        WHERE t.threshold_crossed_at IS NOT NULL
        AND t.latest_price_usd IS NOT NULL
        AND t.first_price_usd > 0
      )
      SELECT * FROM price_changes
      WHERE price_change_pct > 0
      ORDER BY price_change_pct DESC
      LIMIT 50
    `;
    
    const result = await pool.query(query);
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching gainers:', error);
    res.status(500).json({ error: 'Failed to fetch gainers' });
  }
});

// Start server
server.listen(PORT, () => {
  const dashboardUrl = `http://localhost:${PORT}`;
  console.log(`🚀 API server (unified) running on ${dashboardUrl}`);
  console.log(`📊 Dashboard available at ${dashboardUrl}`);
  
  // WebSocket disabled - dashboard works fine without real-time updates
  console.log(`📊 Dashboard API endpoints available`);
  
  // Log dashboard URL - user can manually open
  console.log('Please open your browser to:', dashboardUrl);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down server...');
  await pool.end();
  process.exit(0);
});