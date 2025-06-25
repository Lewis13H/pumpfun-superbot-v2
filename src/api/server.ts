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
app.get('/api/tokens', async (req, res) => {
  try {
    // Get all tokens with their latest price data and enrichment info
    const query = `
      WITH latest_prices AS (
        SELECT DISTINCT ON (token) 
          token,
          price_usd,
          price_sol,
          market_cap_usd,
          progress,
          time as last_update
        FROM price_updates
        ORDER BY token, time DESC
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
        lp.market_cap_usd, lp.progress, lp.last_update,
        pc.change_5m, pc.change_1h, pc.change_6h, pc.change_24h
      ORDER BY lp.market_cap_usd DESC NULLS LAST
    `;
    
    const result = await db.query(query);
    
    // Transform the data for the frontend
    const tokens = result.rows.map(row => ({
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
    
    res.json({
      success: true,
      token: result.rows[0]
    });
    
  } catch (error) {
    console.error('Error fetching token details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch token details'
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