#!/usr/bin/env node
import 'dotenv/config';
import { db } from '../database';

async function viewSavedTokens() {
  console.log('📊 Viewing Saved Tokens ($8888+ Market Cap)\n');
  
  try {
    // Get all saved tokens with their latest price data
    const query = `
      SELECT 
        t.address,
        t.created_at as first_seen,
        p.price_usd as current_price,
        p.market_cap_usd as current_mcap,
        p.progress,
        p.liquidity_sol,
        p.bonding_complete,
        p.time as last_update,
        COUNT(DISTINCT pu.time) as price_updates_count
      FROM tokens t
      LEFT JOIN LATERAL (
        SELECT * FROM price_updates
        WHERE token = t.address
        ORDER BY time DESC
        LIMIT 1
      ) p ON true
      LEFT JOIN price_updates pu ON pu.token = t.address
      GROUP BY t.address, t.created_at, p.price_usd, p.market_cap_usd, 
               p.progress, p.liquidity_sol, p.bonding_complete, p.time
      ORDER BY p.market_cap_usd DESC NULLS LAST
    `;
    
    const result = await db.query(query);
    
    if (result.rows.length === 0) {
      console.log('No tokens saved yet. Tokens are saved when they reach $8888 market cap.');
      return;
    }
    
    console.log(`Found ${result.rows.length} saved tokens:\n`);
    
    for (const token of result.rows) {
      const progress = parseFloat(token.progress || 0);
      const progressBar = createProgressBar(progress);
      const status = token.bonding_complete ? '✅ Migrated' : '🔄 Active';
      
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Token: ${token.address}`);
      console.log(`First Seen: ${new Date(token.first_seen).toLocaleString()}`);
      console.log(`Current Price: $${parseFloat(token.current_price || 0).toFixed(8)}`);
      console.log(`Market Cap: $${parseFloat(token.current_mcap || 0).toFixed(2)}`);
      console.log(`Progress: ${progressBar} ${progress.toFixed(1)}%`);
      console.log(`Liquidity: ${parseFloat(token.liquidity_sol || 0).toFixed(4)} SOL`);
      console.log(`Status: ${status}`);
      console.log(`Price Updates: ${token.price_updates_count}`);
      console.log(`Last Update: ${token.last_update ? new Date(token.last_update).toLocaleString() : 'N/A'}`);
    }
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    // Show summary statistics
    const statsQuery = `
      SELECT 
        COUNT(DISTINCT token) as total_tokens,
        COUNT(*) as total_price_updates,
        AVG(market_cap_usd) as avg_mcap,
        MAX(market_cap_usd) as max_mcap,
        MIN(market_cap_usd) as min_mcap
      FROM price_updates
    `;
    
    const stats = await db.query(statsQuery);
    const stat = stats.rows[0];
    
    console.log('📈 Statistics:');
    console.log(`   Total Tokens Tracked: ${stat.total_tokens}`);
    console.log(`   Total Price Updates: ${stat.total_price_updates}`);
    console.log(`   Average Market Cap: $${parseFloat(stat.avg_mcap || 0).toFixed(2)}`);
    console.log(`   Highest Market Cap: $${parseFloat(stat.max_mcap || 0).toFixed(2)}`);
    console.log(`   Lowest Market Cap: $${parseFloat(stat.min_mcap || 0).toFixed(2)}`);
    
  } catch (error) {
    console.error('Error querying database:', error);
  } finally {
    await db.close();
  }
}

function createProgressBar(progress: number): string {
  const filled = Math.floor(progress / 5);
  const empty = 20 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

viewSavedTokens().catch(console.error);