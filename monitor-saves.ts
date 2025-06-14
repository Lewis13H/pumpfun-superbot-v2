// monitor-saves.ts
// Real-time monitor showing exactly what's being saved to database

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { format } from 'date-fns';

dotenv.config();

// Type definitions
interface TokenRecord {
  address: string;
  bonding_curve: string;
  vanity_id: string | null;
  symbol: string | null;
  name: string | null;
  image_uri: string | null;
  created_at: Date;
  creator: string;
  graduated: boolean;
  archived: boolean;
}

interface PriceRecord {
  time: Date;
  token: string;
  price_sol: string;
  price_usd: string;
  liquidity_sol: string;
  liquidity_usd: string;
  market_cap_usd: string;
  bonding_complete: boolean;
}

interface TokenInfo {
  symbol: string | null;
  name: string | null;
}

interface Summary {
  total_tokens: string;
  tokens_last_hour: string;
  prices_last_hour: string;
  active_tokens_last_hour: string;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Track last seen records
let lastTokenTime: Date | null = null;
let lastPriceTime: Date | null = null;

async function monitorSaves() {
  try {
    // Check for new tokens
    const newTokensQuery = lastTokenTime 
      ? `SELECT * FROM tokens WHERE created_at > $1 ORDER BY created_at DESC`
      : `SELECT * FROM tokens ORDER BY created_at DESC LIMIT 5`;
    
    const newTokens = await pool.query(
      newTokensQuery, 
      lastTokenTime ? [lastTokenTime] : []
    );

    if (newTokens.rows.length > 0) {
      console.log('\n🆕 NEW TOKENS SAVED:');
      console.log('====================');
      
      for (const token of newTokens.rows) {
        console.log(`\n🪙 Token: ${token.symbol || 'PENDING'} (${token.name || 'PENDING'})`);
        console.log('📋 Full Database Record:');
        console.log(JSON.stringify({
          address: token.address,
          bonding_curve: token.bonding_curve,
          vanity_id: token.vanity_id,
          symbol: token.symbol,
          name: token.name,
          image_uri: token.image_uri,
          created_at: format(new Date(token.created_at), 'yyyy-MM-dd HH:mm:ss'),
          creator: token.creator,
          graduated: token.graduated,
          archived: token.archived
        }, null, 2));
      }
      
      // Update last seen time
      lastTokenTime = new Date(newTokens.rows[0].created_at);
    }

    // Check for new price updates
    const priceQuery = lastPriceTime
      ? `SELECT * FROM price_updates WHERE time > $1 ORDER BY time DESC LIMIT 20`
      : `SELECT * FROM price_updates ORDER BY time DESC LIMIT 5`;
    
    const newPrices = await pool.query(
      priceQuery,
      lastPriceTime ? [lastPriceTime] : []
    );

    if (newPrices.rows.length > 0) {
      console.log('\n💰 NEW PRICE UPDATES:');
      console.log('=====================');
      
      // Group by token
      const pricesByToken = newPrices.rows.reduce((acc: Record<string, PriceRecord[]>, price: PriceRecord) => {
        if (!acc[price.token]) acc[price.token] = [];
        acc[price.token].push(price);
        return acc;
      }, {} as Record<string, PriceRecord[]>);

      for (const [tokenAddress, prices] of Object.entries(pricesByToken)) {
        // Get token info
        const tokenInfo = await pool.query(
          'SELECT symbol, name FROM tokens WHERE address = $1',
          [tokenAddress]
        );
        
        const token = tokenInfo.rows[0];
        console.log(`\n📊 ${token?.symbol || tokenAddress.substring(0, 8) + '...'}`);
        
        const latestPrice = prices[0];
        console.log('📋 Latest Price Data:');
        console.log(JSON.stringify({
          time: format(new Date(latestPrice.time), 'yyyy-MM-dd HH:mm:ss'),
          price_sol: parseFloat(latestPrice.price_sol).toFixed(12),
          price_usd: parseFloat(latestPrice.price_usd).toFixed(8),
          liquidity_sol: parseFloat(latestPrice.liquidity_sol).toFixed(4),
          liquidity_usd: parseFloat(latestPrice.liquidity_usd).toFixed(2),
          market_cap_usd: parseFloat(latestPrice.market_cap_usd).toFixed(2),
          bonding_complete: latestPrice.bonding_complete
        }, null, 2));
      }
      
      // Update last seen time
      lastPriceTime = new Date(newPrices.rows[0].time);
    }

  } catch (error) {
    console.error('❌ Error monitoring saves:', error);
  }
}

async function showSummary() {
  try {
    const summary = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM tokens) as total_tokens,
        (SELECT COUNT(*) FROM tokens WHERE created_at > NOW() - INTERVAL '1 hour') as tokens_last_hour,
        (SELECT COUNT(*) FROM price_updates WHERE time > NOW() - INTERVAL '1 hour') as prices_last_hour,
        (SELECT COUNT(DISTINCT token) FROM price_updates WHERE time > NOW() - INTERVAL '1 hour') as active_tokens_last_hour
    `);

    console.log('\n📊 SUMMARY:');
    console.log('===========');
    console.log(`Total Tokens: ${summary.rows[0].total_tokens}`);
    console.log(`New Tokens (Last Hour): ${summary.rows[0].tokens_last_hour}`);
    console.log(`Price Updates (Last Hour): ${summary.rows[0].prices_last_hour}`);
    console.log(`Active Tokens (Last Hour): ${summary.rows[0].active_tokens_last_hour}`);
  } catch (error) {
    console.error('❌ Error getting summary:', error);
  }
}

// Main monitoring loop
async function startMonitoring() {
  console.log('🔍 Real-time Database Monitor Started');
  console.log('=====================================');
  console.log('Showing all data being saved to database...\n');

  // Show initial summary
  await showSummary();

  // Monitor for changes every 5 seconds
  setInterval(async () => {
    await monitorSaves();
  }, 5000);

  // Update summary every minute
  setInterval(async () => {
    await showSummary();
  }, 60000);
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n👋 Shutting down monitor...');
  await pool.end();
  process.exit(0);
});

// Start monitoring
startMonitoring();