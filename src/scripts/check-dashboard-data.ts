/**
 * Check Dashboard Data
 * Verifies what tokens are available for the dashboard
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    console.log('🌐 Dashboard Data Check\n');
    
    // Get active tokens (what dashboard shows)
    const activeTokens = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated,
        COUNT(*) FILTER (WHERE current_program = 'bonding_curve') as bonding_curve,
        COUNT(*) FILTER (WHERE current_program = 'amm_pool') as amm_pool,
        COUNT(*) FILTER (WHERE latest_market_cap_usd >= 10000) as above_10k,
        COUNT(*) FILTER (WHERE latest_market_cap_usd >= 100000) as above_100k
      FROM tokens_unified
      WHERE is_active = true 
        AND should_remove = false
    `);
    
    const stats = activeTokens.rows[0];
    console.log('📊 Active Tokens Summary:');
    console.log(`Total active tokens: ${stats.total}`);
    console.log(`Graduated (AMM): ${stats.graduated} (${(stats.graduated / stats.total * 100).toFixed(1)}%)`);
    console.log(`Bonding Curve: ${stats.bonding_curve}`);
    console.log(`AMM Pool: ${stats.amm_pool}`);
    console.log(`Market Cap > $10k: ${stats.above_10k}`);
    console.log(`Market Cap > $100k: ${stats.above_100k}`);
    
    // Get top AMM tokens
    console.log('\n🏆 Top AMM Tokens by Market Cap:');
    const topAmm = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_price_usd,
        latest_market_cap_usd,
        volume_24h_usd,
        holder_count,
        graduated_to_amm,
        updated_at
      FROM tokens_unified
      WHERE graduated_to_amm = true
        AND is_active = true
        AND should_remove = false
      ORDER BY latest_market_cap_usd DESC NULLS LAST
      LIMIT 10
    `);
    
    if (topAmm.rows.length === 0) {
      console.log('No graduated tokens found with market cap data.');
    } else {
      topAmm.rows.forEach((token, i) => {
        console.log(`\n${i + 1}. ${token.symbol || 'N/A'} - ${token.name || 'Unknown'}`);
        console.log(`   Mint: ${token.mint_address}`);
        console.log(`   Market Cap: $${token.latest_market_cap_usd?.toLocaleString() || '0'}`);
        console.log(`   Price: $${token.latest_price_usd?.toFixed(6) || '0'}`);
        console.log(`   24h Volume: $${token.volume_24h_usd?.toLocaleString() || '0'}`);
        console.log(`   Holders: ${token.holder_count || 'N/A'}`);
        console.log(`   Last Update: ${token.updated_at.toISOString()}`);
      });
    }
    
    // Recent activity
    console.log('\n📈 Recent Activity (last hour):');
    const recentActivity = await pool.query(`
      SELECT 
        'token' as type,
        mint_address as identifier,
        symbol,
        current_program as detail,
        created_at as timestamp
      FROM tokens_unified
      WHERE created_at >= NOW() - INTERVAL '1 hour'
      UNION ALL
      SELECT 
        'trade' as type,
        mint_address as identifier,
        '' as symbol,
        program as detail,
        created_at as timestamp
      FROM trades_unified
      WHERE created_at >= NOW() - INTERVAL '1 hour'
        AND program = 'amm_pool'
      ORDER BY timestamp DESC
      LIMIT 20
    `);
    
    const tokenCount = recentActivity.rows.filter(r => r.type === 'token').length;
    const tradeCount = recentActivity.rows.filter(r => r.type === 'trade').length;
    
    console.log(`New tokens: ${tokenCount}`);
    console.log(`AMM trades: ${tradeCount}`);
    
    // Dashboard endpoints
    console.log('\n🔗 Dashboard Endpoints:');
    console.log('Main dashboard: http://localhost:3001');
    console.log('API - All tokens: http://localhost:3001/api/tokens');
    console.log('API - Graduated only: http://localhost:3001/api/tokens?graduated=true');
    console.log('API - Token detail: http://localhost:3001/api/tokens/{mint_address}');
    
    // Real-time updates
    console.log('\n⚡ Real-Time Updates:');
    const realtimeCheck = await pool.query(`
      SELECT COUNT(*) as recent_updates
      FROM tokens_unified
      WHERE updated_at >= NOW() - INTERVAL '1 minute'
    `);
    
    console.log(`Tokens updated in last minute: ${realtimeCheck.rows[0].recent_updates}`);
    console.log('Dashboard auto-refreshes every 10 seconds');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);