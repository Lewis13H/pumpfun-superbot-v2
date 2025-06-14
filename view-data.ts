// view-data.ts
// Script to view all data in your database

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { format } from 'date-fns';

dotenv.config();

// Type definitions
interface TokenStats {
  total_tokens: string;
  graduated_tokens: string;
  archived_tokens: string;
  tokens_with_metadata: string;
}

interface TokenData {
  address: string;
  symbol: string | null;
  name: string | null;
  created_at: Date;
  creator: string;
  graduated: boolean;
  current_price: number | null;
  market_cap: number | null;
  liquidity_sol: number | null;
}

interface TopToken {
  symbol: string;
  name: string;
  address: string;
  market_cap_usd: number;
  price_usd: number;
  liquidity_sol: number;
}

interface PriceActivity {
  hour: Date;
  updates: string;
  unique_tokens: string;
}

interface NoMetadataToken {
  address: string;
  created_at: Date;
}

interface BondingProgress {
  symbol: string;
  name: string;
  liquidity_sol: number;
  status: string;
  progress_percent: number;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function viewData() {
  console.log('🔍 Pump.fun Database Viewer\n');

  try {
    // 1. Database Statistics
    console.log('📊 DATABASE STATISTICS');
    console.log('======================');
    
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN graduated = true THEN 1 END) as graduated_tokens,
        COUNT(CASE WHEN archived = true THEN 1 END) as archived_tokens,
        COUNT(CASE WHEN symbol IS NOT NULL THEN 1 END) as tokens_with_metadata
      FROM tokens
    `);
    
    console.log(`Total Tokens: ${stats.rows[0].total_tokens}`);
    console.log(`Graduated: ${stats.rows[0].graduated_tokens}`);
    console.log(`Archived: ${stats.rows[0].archived_tokens}`);
    console.log(`With Metadata: ${stats.rows[0].tokens_with_metadata}`);

    // 2. Recent Tokens
    console.log('\n\n📝 RECENT TOKENS (Last 10)');
    console.log('===========================');
    
    const recentTokens = await pool.query(`
      SELECT 
        t.address,
        t.symbol,
        t.name,
        t.created_at,
        t.creator,
        t.graduated,
        p.price_usd as current_price,
        p.market_cap_usd as market_cap,
        p.liquidity_sol
      FROM tokens t
      LEFT JOIN LATERAL (
        SELECT * FROM price_updates 
        WHERE token = t.address 
        ORDER BY time DESC 
        LIMIT 1
      ) p ON true
      WHERE NOT t.archived
      ORDER BY t.created_at DESC
      LIMIT 10
    `);

    for (const token of recentTokens.rows) {
      console.log(`\n🪙 ${token.symbol || 'NO_SYMBOL'} (${token.name || 'NO_NAME'})`);
      console.log(`   Address: ${token.address}`);
      console.log(`   Created: ${format(new Date(token.created_at), 'yyyy-MM-dd HH:mm:ss')}`);
      console.log(`   Creator: ${token.creator}`);
      console.log(`   Price: $${token.current_price ? token.current_price.toFixed(8) : 'N/A'}`);
      console.log(`   Market Cap: $${token.market_cap ? Number(token.market_cap).toLocaleString() : 'N/A'}`);
      console.log(`   Liquidity: ${token.liquidity_sol ? token.liquidity_sol.toFixed(2) : 'N/A'} SOL`);
      console.log(`   Graduated: ${token.graduated ? '✅' : '❌'}`);
    }

    // 3. Top Tokens by Market Cap
    console.log('\n\n💎 TOP TOKENS BY MARKET CAP');
    console.log('=============================');
    
    const topTokens = await pool.query(`
      SELECT 
        t.symbol,
        t.name,
        t.address,
        p.market_cap_usd,
        p.price_usd,
        p.liquidity_sol
      FROM tokens t
      INNER JOIN LATERAL (
        SELECT * FROM price_updates 
        WHERE token = t.address 
        ORDER BY time DESC 
        LIMIT 1
      ) p ON true
      WHERE NOT t.archived AND p.market_cap_usd IS NOT NULL
      ORDER BY p.market_cap_usd DESC
      LIMIT 10
    `);

    topTokens.rows.forEach((token: TopToken, index: number) => {
      console.log(`\n${index + 1}. ${token.symbol} (${token.name})`);
      console.log(`   Market Cap: $${Number(token.market_cap_usd).toLocaleString()}`);
      console.log(`   Price: $${token.price_usd.toFixed(8)}`);
      console.log(`   Liquidity: ${token.liquidity_sol.toFixed(2)} SOL`);
    });

    // 4. Price Update Activity
    console.log('\n\n📈 PRICE UPDATE ACTIVITY');
    console.log('=========================');
    
    const priceActivity = await pool.query(`
      SELECT 
        DATE_TRUNC('hour', time) as hour,
        COUNT(*) as updates,
        COUNT(DISTINCT token) as unique_tokens
      FROM price_updates
      WHERE time > NOW() - INTERVAL '24 hours'
      GROUP BY hour
      ORDER BY hour DESC
      LIMIT 10
    `);

    console.log('Last 10 hours:');
    priceActivity.rows.forEach((row: PriceActivity) => {
      console.log(`${format(new Date(row.hour), 'yyyy-MM-dd HH:mm')} - ${row.updates} updates for ${row.unique_tokens} tokens`);
    });

    // 5. Tokens Without Metadata
    console.log('\n\n⚠️  TOKENS WITHOUT METADATA');
    console.log('============================');
    
    const noMetadata = await pool.query(`
      SELECT address, created_at
      FROM tokens
      WHERE symbol IS NULL OR name IS NULL
      ORDER BY created_at DESC
      LIMIT 5
    `);

    if (noMetadata.rows.length > 0) {
      noMetadata.rows.forEach((token: NoMetadataToken) => {
        console.log(`${token.address} - Created: ${format(new Date(token.created_at), 'yyyy-MM-dd HH:mm:ss')}`);
      });
      console.log(`\nTotal without metadata: ${noMetadata.rowCount} tokens`);
    } else {
      console.log('All tokens have metadata! ✅');
    }

    // 6. Bonding Curve Progress
    console.log('\n\n🎯 BONDING CURVE PROGRESS');
    console.log('==========================');
    
    const bondingProgress = await pool.query(`
      SELECT 
        t.symbol,
        t.name,
        p.liquidity_sol,
        CASE 
          WHEN p.liquidity_sol >= 85 THEN '🚀 GRADUATED!'
          WHEN p.liquidity_sol >= 70 THEN '🔥 Almost there!'
          WHEN p.liquidity_sol >= 50 THEN '📈 Halfway'
          WHEN p.liquidity_sol >= 25 THEN '📊 Growing'
          ELSE '🌱 Early stage'
        END as status,
        ROUND((p.liquidity_sol / 85.0 * 100)::numeric, 2) as progress_percent
      FROM tokens t
      INNER JOIN LATERAL (
        SELECT * FROM price_updates 
        WHERE token = t.address 
        ORDER BY time DESC 
        LIMIT 1
      ) p ON true
      WHERE NOT t.archived AND NOT t.graduated
      ORDER BY p.liquidity_sol DESC
      LIMIT 10
    `);

    bondingProgress.rows.forEach((token: BondingProgress) => {
      console.log(`\n${token.symbol} - ${token.status}`);
      console.log(`   Liquidity: ${token.liquidity_sol.toFixed(2)} SOL (${token.progress_percent}% to graduation)`);
    });

  } catch (error) {
    console.error('❌ Error querying database:', error);
  } finally {
    await pool.end();
  }
}

// Add command line arguments support
const args = process.argv.slice(2);
if (args.includes('--watch')) {
  // Watch mode - refresh every 30 seconds
  console.log('👀 Watch mode enabled - refreshing every 30 seconds\n');
  viewData();
  setInterval(() => {
    console.clear();
    viewData();
  }, 30000);
} else {
  viewData();
}