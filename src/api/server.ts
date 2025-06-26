import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { db } from '../database';
import { openDashboard } from './open-dashboard';

const app = express();
const PORT = process.env.API_PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static dashboard files
app.use(express.static(path.join(__dirname, '../../dashboard')));

// API endpoint for tokens
app.get('/api/tokens', async (_req, res) => {
  try {
    // Get all tokens with their latest price data and enrichment info
    const query = `
      WITH latest_prices AS (
        SELECT DISTINCT ON (t.address) 
          t.address as token,
          COALESCE(t.last_price_usd, p.price_usd) as price_usd,
          COALESCE(t.last_price_usd / NULLIF((SELECT price FROM sol_prices ORDER BY timestamp DESC LIMIT 1), 0), p.price_sol) as price_sol,
          COALESCE(t.last_price_usd * 1000000000, p.market_cap_usd) as market_cap_usd,
          CASE WHEN t.graduated THEN 100 ELSE COALESCE(p.progress, 0) END as progress,
          COALESCE(t.last_updated, p.time) as last_update,
          t.graduated
        FROM tokens t
        LEFT JOIN LATERAL (
          SELECT * FROM price_updates 
          WHERE token = t.address 
          ORDER BY time DESC 
          LIMIT 1
        ) p ON true
      ),
      price_changes AS (
        SELECT 
          p.token,
          -- 5 minute change
          (SELECT ((p.price_usd - p5.price_usd) / NULLIF(p5.price_usd, 0)) * 100
           FROM price_updates p5 
           WHERE p5.token = p.token 
           AND p5.time <= NOW() - INTERVAL '5 minutes'
           ORDER BY p5.time DESC LIMIT 1) as change_5m,
          -- 1 hour change
          (SELECT ((p.price_usd - p1h.price_usd) / NULLIF(p1h.price_usd, 0)) * 100
           FROM price_updates p1h 
           WHERE p1h.token = p.token 
           AND p1h.time <= NOW() - INTERVAL '1 hour'
           ORDER BY p1h.time DESC LIMIT 1) as change_1h,
          -- 6 hour change
          (SELECT ((p.price_usd - p6h.price_usd) / NULLIF(p6h.price_usd, 0)) * 100
           FROM price_updates p6h 
           WHERE p6h.token = p.token 
           AND p6h.time <= NOW() - INTERVAL '6 hours'
           ORDER BY p6h.time DESC LIMIT 1) as change_6h,
          -- 24 hour change
          (SELECT ((p.price_usd - p24h.price_usd) / NULLIF(p24h.price_usd, 0)) * 100
           FROM price_updates p24h 
           WHERE p24h.token = p.token 
           AND p24h.time <= NOW() - INTERVAL '24 hours'
           ORDER BY p24h.time DESC LIMIT 1) as change_24h
        FROM latest_prices p
      )
      SELECT 
        t.address,
        t.name,
        t.symbol,
        t.image_uri,
        t.creator,
        t.holder_count,
        t.top_holder_percentage,
        t.volume_24h_usd,
        t.volume_24h_sol,
        EXTRACT(EPOCH FROM (NOW() - t.created_at)) as age,
        lp.price_usd,
        lp.price_sol,
        lp.market_cap_usd,
        lp.progress,
        lp.last_update,
        lp.graduated,
        pc.change_5m,
        pc.change_1h,
        pc.change_6h,
        pc.change_24h,
        COUNT(DISTINCT pu.time) as price_updates_count
      FROM tokens t
      LEFT JOIN latest_prices lp ON t.address = lp.token
      LEFT JOIN price_changes pc ON t.address = pc.token
      LEFT JOIN price_updates pu ON t.address = pu.token
      GROUP BY 
        t.address, t.name, t.symbol, t.image_uri, t.creator,
        t.holder_count, t.top_holder_percentage, t.volume_24h_usd,
        t.volume_24h_sol, t.created_at, lp.price_usd, lp.price_sol,
        lp.market_cap_usd, lp.progress, lp.last_update, lp.graduated,
        pc.change_5m, pc.change_1h, pc.change_6h, pc.change_24h
      ORDER BY lp.market_cap_usd DESC NULLS LAST
    `;
    
    const result = await db.query(query);
    
    // Transform the data for the frontend
    const tokens = result.rows.map((row: any) => ({
      address: row.address,
      name: row.name,
      symbol: row.symbol,
      image_uri: row.image_uri,
      creator: row.creator,
      holder_count: row.holder_count,
      top_holder_percentage: parseFloat(row.top_holder_percentage || 0),
      price_usd: parseFloat(row.price_usd || 0),
      price_sol: parseFloat(row.price_sol || 0),
      market_cap_usd: parseFloat(row.market_cap_usd || 0),
      progress: parseFloat(row.progress || 0),
      graduated: row.graduated || false,
      age: row.age,
      change_5m: row.change_5m ? parseFloat(row.change_5m) : null,
      change_1h: row.change_1h ? parseFloat(row.change_1h) : null,
      change_6h: row.change_6h ? parseFloat(row.change_6h) : null,
      change_24h: row.change_24h ? parseFloat(row.change_24h) : null,
      volume_24h: parseFloat(row.volume_24h_usd || 0),
      txns: 0, // Not tracked yet
      makers: 0, // Not tracked yet
      liquidity: 0, // Not tracked yet
      last_update: row.last_update,
      price_updates_count: parseInt(row.price_updates_count || 0)
    }));
    
    res.json({
      success: true,
      tokens,
      timestamp: new Date().toISOString(),
      total: tokens.length
    });
    
  } catch (error) {
    console.error('Error fetching tokens:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tokens'
    });
  }
});

// Get token details
app.get('/api/tokens/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    const query = `
      SELECT 
        t.*,
        (
          SELECT json_agg(
            json_build_object(
              'time', time,
              'price_usd', price_usd,
              'market_cap_usd', market_cap_usd,
              'progress', progress
            ) ORDER BY time DESC
          )
          FROM price_updates
          WHERE token = t.address
          AND time > NOW() - INTERVAL '24 hours'
        ) as price_history
      FROM tokens t
      WHERE t.address = $1
    `;
    
    const result = await db.query(query, [address]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Token not found'
      });
    }
    
    return res.json({
      success: true,
      token: result.rows[0]
    });
    
  } catch (error) {
    console.error('Error fetching token details:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch token details'
    });
  }
});

// API endpoint for graduated tokens
app.get('/api/graduated', async (_req, res) => {
  try {
    const query = `
      WITH latest_prices AS (
        SELECT DISTINCT ON (t.address) 
          t.address as token,
          COALESCE(t.last_price_usd, p.price_usd) as price_usd,
          COALESCE(t.last_price_usd / NULLIF((SELECT price FROM sol_prices ORDER BY timestamp DESC LIMIT 1), 0), p.price_sol) as price_sol,
          COALESCE(t.last_price_usd * 1000000000, p.market_cap_usd) as market_cap_usd,
          COALESCE(t.last_updated, p.time) as last_update
        FROM tokens t
        LEFT JOIN LATERAL (
          SELECT * FROM price_updates 
          WHERE token = t.address 
          AND is_graduated = true
          ORDER BY time DESC 
          LIMIT 1
        ) p ON true
        WHERE t.graduated = true
      ),
      price_changes AS (
        SELECT 
          p.token,
          -- 24 hour change
          (SELECT ((p.price_usd - p24h.price_usd) / NULLIF(p24h.price_usd, 0)) * 100
           FROM price_updates p24h 
           WHERE p24h.token = p.token 
           AND p24h.time <= NOW() - INTERVAL '24 hours'
           ORDER BY p24h.time DESC LIMIT 1) as change_24h,
          -- Price at graduation
          (SELECT price_usd 
           FROM price_updates pg
           WHERE pg.token = p.token 
           AND pg.is_graduated = false
           ORDER BY pg.time DESC LIMIT 1) as graduation_price
        FROM latest_prices p
      )
      SELECT 
        t.address,
        t.name,
        t.symbol,
        t.image_uri,
        t.graduation_time,
        t.pool_address,
        t.volume_24h_usd,
        ge.pool_address as dex_pool,
        ge.sol_amount as graduation_sol,
        lp.price_usd,
        lp.price_sol,
        lp.market_cap_usd,
        lp.last_update,
        pc.change_24h,
        pc.graduation_price,
        CASE 
          WHEN pc.graduation_price > 0 
          THEN ((lp.price_usd - pc.graduation_price) / pc.graduation_price) * 100
          ELSE NULL 
        END as change_since_graduation
      FROM tokens t
      LEFT JOIN latest_prices lp ON t.address = lp.token
      LEFT JOIN price_changes pc ON t.address = pc.token
      LEFT JOIN graduation_events ge ON t.address = ge.mint
      WHERE t.graduated = true
      ORDER BY t.graduation_time DESC NULLS LAST
    `;
    
    const result = await db.query(query);
    
    const tokens = result.rows.map((row: any) => ({
      address: row.address,
      name: row.name,
      symbol: row.symbol,
      image_uri: row.image_uri,
      graduation_time: row.graduation_time,
      pool_address: row.pool_address || row.dex_pool,
      price_usd: parseFloat(row.price_usd || 0),
      price_sol: parseFloat(row.price_sol || 0),
      market_cap_usd: parseFloat(row.market_cap_usd || 0),
      graduation_price: parseFloat(row.graduation_price || 0),
      graduation_sol: parseFloat(row.graduation_sol || 0),
      change_24h: row.change_24h ? parseFloat(row.change_24h) : null,
      change_since_graduation: row.change_since_graduation ? parseFloat(row.change_since_graduation) : null,
      volume_24h: parseFloat(row.volume_24h_usd || 0),
      last_update: row.last_update
    }));
    
    res.json({
      success: true,
      tokens,
      count: tokens.length
    });
    
  } catch (error) {
    console.error('Error fetching graduated tokens:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch graduated tokens'
    });
  }
});

// API endpoint for bonding curve tokens
app.get('/api/bonding', async (_req, res) => {
  try {
    const query = `
      WITH latest_prices AS (
        SELECT DISTINCT ON (t.address) 
          t.address as token,
          p.price_usd,
          p.price_sol,
          p.market_cap_usd,
          p.progress,
          p.time as last_update,
          p.liquidity_sol,
          p.liquidity_usd
        FROM tokens t
        LEFT JOIN LATERAL (
          SELECT * FROM price_updates 
          WHERE token = t.address 
          ORDER BY time DESC 
          LIMIT 1
        ) p ON true
        WHERE t.graduated = false OR t.graduated IS NULL
      ),
      price_changes AS (
        SELECT 
          p.token,
          -- 5 minute change
          (SELECT ((p.price_usd - p5.price_usd) / NULLIF(p5.price_usd, 0)) * 100
           FROM price_updates p5 
           WHERE p5.token = p.token 
           AND p5.time <= NOW() - INTERVAL '5 minutes'
           ORDER BY p5.time DESC LIMIT 1) as change_5m,
          -- 1 hour change
          (SELECT ((p.price_usd - p1h.price_usd) / NULLIF(p1h.price_usd, 0)) * 100
           FROM price_updates p1h 
           WHERE p1h.token = p.token 
           AND p1h.time <= NOW() - INTERVAL '1 hour'
           ORDER BY p1h.time DESC LIMIT 1) as change_1h,
          -- 6 hour change
          (SELECT ((p.price_usd - p6h.price_usd) / NULLIF(p6h.price_usd, 0)) * 100
           FROM price_updates p6h 
           WHERE p6h.token = p.token 
           AND p6h.time <= NOW() - INTERVAL '6 hours'
           ORDER BY p6h.time DESC LIMIT 1) as change_6h,
          -- 24 hour change
          (SELECT ((p.price_usd - p24h.price_usd) / NULLIF(p24h.price_usd, 0)) * 100
           FROM price_updates p24h 
           WHERE p24h.token = p.token 
           AND p24h.time <= NOW() - INTERVAL '24 hours'
           ORDER BY p24h.time DESC LIMIT 1) as change_24h
        FROM latest_prices p
      )
      SELECT 
        t.address,
        t.name,
        t.symbol,
        t.image_uri,
        t.creator,
        t.holder_count,
        t.top_holder_percentage,
        t.volume_24h_usd,
        EXTRACT(EPOCH FROM (NOW() - t.created_at)) as age,
        lp.price_usd,
        lp.price_sol,
        lp.market_cap_usd,
        lp.progress,
        lp.liquidity_sol,
        lp.liquidity_usd,
        lp.last_update,
        pc.change_5m,
        pc.change_1h,
        pc.change_6h,
        pc.change_24h,
        COUNT(DISTINCT pu.time) as price_updates_count
      FROM tokens t
      LEFT JOIN latest_prices lp ON t.address = lp.token
      LEFT JOIN price_changes pc ON t.address = pc.token
      LEFT JOIN price_updates pu ON t.address = pu.token
      WHERE (t.graduated = false OR t.graduated IS NULL)
      AND lp.price_usd IS NOT NULL
      GROUP BY 
        t.address, t.name, t.symbol, t.image_uri, t.creator,
        t.holder_count, t.top_holder_percentage, t.volume_24h_usd,
        t.created_at, lp.price_usd, lp.price_sol,
        lp.market_cap_usd, lp.progress, lp.liquidity_sol, lp.liquidity_usd,
        lp.last_update, pc.change_5m, pc.change_1h, pc.change_6h, pc.change_24h
      ORDER BY lp.market_cap_usd DESC NULLS LAST
    `;
    
    const result = await db.query(query);
    
    const tokens = result.rows.map((row: any) => ({
      address: row.address,
      name: row.name,
      symbol: row.symbol,
      image_uri: row.image_uri,
      creator: row.creator,
      holder_count: row.holder_count,
      top_holder_percentage: parseFloat(row.top_holder_percentage || 0),
      price_usd: parseFloat(row.price_usd || 0),
      price_sol: parseFloat(row.price_sol || 0),
      market_cap_usd: parseFloat(row.market_cap_usd || 0),
      progress: parseFloat(row.progress || 0),
      liquidity_sol: parseFloat(row.liquidity_sol || 0),
      liquidity_usd: parseFloat(row.liquidity_usd || 0),
      age: row.age,
      change_5m: row.change_5m ? parseFloat(row.change_5m) : null,
      change_1h: row.change_1h ? parseFloat(row.change_1h) : null,
      change_6h: row.change_6h ? parseFloat(row.change_6h) : null,
      change_24h: row.change_24h ? parseFloat(row.change_24h) : null,
      volume_24h: parseFloat(row.volume_24h_usd || 0),
      last_update: row.last_update,
      price_updates_count: parseInt(row.price_updates_count || 0)
    }));
    
    res.json({
      success: true,
      tokens,
      count: tokens.length
    });
    
  } catch (error) {
    console.error('Error fetching bonding tokens:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch bonding tokens'
    });
  }
});

// Start server
app.listen(PORT, () => {
  const dashboardUrl = `http://localhost:${PORT}`;
  console.log(`🚀 API server running on ${dashboardUrl}`);
  console.log(`📊 Dashboard available at ${dashboardUrl}`);
  console.log('\n📱 Opening dashboard in browser...');
  openDashboard(dashboardUrl);
});