import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { Pool } from 'pg';
import { createServer } from 'http';
// import { bcWebSocketServer } from '../services/bc-websocket-server'; // File deleted
// import { unifiedWebSocketServer } from '../services/unified-websocket-server-fixed';
// const WebSocket = require('ws'); // Not used
import bcMonitorEndpoints from './bc-monitor-endpoints';
import ammEndpoints from './amm-endpoints';
import { registerPerformanceEndpoints, initPerformanceWebSocket } from './performance-metrics-endpoints';

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
app.use('/api/bc-monitor', bcMonitorEndpoints);

// AMM API endpoints
app.use('/api/amm', ammEndpoints);

// Register performance monitoring endpoints
registerPerformanceEndpoints(app);

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
        t.volume_24h_usd,
        t.holder_count,
        t.top_holder_percentage,
        t.total_trades,
        t.unique_traders_24h,
        -- Calculate age from actual creation time if available, otherwise from first seen
        EXTRACT(EPOCH FROM (NOW() - COALESCE(t.token_created_at, t.first_seen_at))) as age_seconds,
        -- Get SOL price for calculations
        (SELECT price FROM sol_prices ORDER BY created_at DESC LIMIT 1) as sol_price,
        -- Calculate USD price from SOL price if needed
        CASE 
          WHEN t.latest_price_usd IS NULL OR t.latest_price_usd = 0 
          THEN t.latest_price_sol * (SELECT price FROM sol_prices ORDER BY created_at DESC LIMIT 1)
          ELSE t.latest_price_usd
        END as calculated_price_usd
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
      }
    });
  } catch (error) {
    console.error('Error fetching status:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
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
        -- Get recent price history
        (
          SELECT json_agg(
            json_build_object(
              'created_at', ps.created_at,
              'price_usd', ps.price_usd,
              'market_cap_usd', ps.market_cap_usd
            ) ORDER BY ps.created_at DESC
          )
          FROM price_snapshots_unified ps
          WHERE ps.mint_address = t.mint_address
          AND ps.created_at > NOW() - INTERVAL '24 hours'
          LIMIT 100
        ) as price_history,
        -- Get recent trades
        (
          SELECT json_agg(
            json_build_object(
              'signature', tr.signature,
              'trade_type', tr.trade_type,
              'price_usd', tr.price_usd,
              'sol_amount', tr.sol_amount,
              'created_at', tr.created_at
            ) ORDER BY tr.created_at DESC
          )
          FROM trades_unified tr
          WHERE tr.mint_address = t.mint_address
          LIMIT 20
        ) as recent_trades
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