#!/usr/bin/env node
import 'dotenv/config';
import { db } from '../database';

async function viewEnrichedTokens() {
  console.log('📊 Viewing Enriched Token Data\n');
  
  try {
    // Get enriched tokens with their latest price data
    const query = `
      SELECT 
        t.address,
        t.name,
        t.symbol,
        t.description,
        t.creator,
        t.holder_count,
        t.top_holder_percentage,
        t.helius_updated_at,
        t.created_at as first_seen,
        p.price_usd as current_price,
        p.market_cap_usd as current_mcap,
        p.progress,
        p.time as last_price_update,
        COUNT(DISTINCT pu.time) as price_updates_count
      FROM tokens t
      LEFT JOIN LATERAL (
        SELECT * FROM price_updates
        WHERE token = t.address
        ORDER BY time DESC
        LIMIT 1
      ) p ON true
      LEFT JOIN price_updates pu ON pu.token = t.address
      WHERE t.helius_updated_at IS NOT NULL
      GROUP BY t.address, t.name, t.symbol, t.description, t.creator,
               t.holder_count, t.top_holder_percentage, t.helius_updated_at,
               t.created_at, p.price_usd, p.market_cap_usd, 
               p.progress, p.time
      ORDER BY t.holder_count DESC NULLS LAST
    `;
    
    const result = await db.query(query);
    
    if (result.rows.length === 0) {
      console.log('No enriched tokens found. Run "npm run enrich-tokens" first.');
      return;
    }
    
    console.log(`Found ${result.rows.length} enriched tokens:\n`);
    
    for (const token of result.rows) {
      const progressBar = createProgressBar(parseFloat(token.progress || 0));
      
      console.log(`${'═'.repeat(70)}`);
      console.log(`🪙 ${token.symbol || 'Unknown'} - ${token.name || 'Unnamed Token'}`);
      console.log(`📍 ${token.address}`);
      
      if (token.description) {
        console.log(`📝 ${token.description.substring(0, 100)}${token.description.length > 100 ? '...' : ''}`);
      }
      
      console.log(`\n💼 Creator: ${token.creator}`);
      console.log(`👥 Holders: ${token.holder_count || 0}`);
      console.log(`🐋 Top Holder: ${parseFloat(token.top_holder_percentage || 0).toFixed(2)}%`);
      
      console.log(`\n💰 Price: $${parseFloat(token.current_price || 0).toFixed(8)}`);
      console.log(`📈 Market Cap: $${parseFloat(token.current_mcap || 0).toFixed(2)}`);
      console.log(`📊 Progress: ${progressBar} ${parseFloat(token.progress || 0).toFixed(1)}%`);
      
      console.log(`\n⏰ First Seen: ${new Date(token.first_seen).toLocaleString()}`);
      console.log(`🔄 Helius Updated: ${token.helius_updated_at ? new Date(token.helius_updated_at).toLocaleString() : 'Never'}`);
      console.log(`📊 Price Updates: ${token.price_updates_count}`);
    }
    
    console.log(`\n${'═'.repeat(70)}\n`);
    
    // Show holder distribution for top token
    const topToken = result.rows[0];
    if (topToken && topToken.holder_count > 0) {
      console.log(`🏆 Top Holders for ${topToken.symbol || topToken.address}:\n`);
      
      const holdersResult = await db.query(`
        SELECT wallet, percentage, balance, rank
        FROM token_holders
        WHERE token = $1
        ORDER BY rank
        LIMIT 10
      `, [topToken.address]);
      
      if (holdersResult.rows.length > 0) {
        console.log('Rank | Wallet                                      | Percentage | Balance');
        console.log('-----|---------------------------------------------|------------|--------');
        
        for (const holder of holdersResult.rows) {
          const wallet = holder.wallet.substring(0, 6) + '...' + holder.wallet.substring(holder.wallet.length - 4);
          console.log(
            `${holder.rank.toString().padStart(4)} | ${wallet.padEnd(43)} | ${
              parseFloat(holder.percentage).toFixed(2).padStart(9)
            }% | ${parseInt(holder.balance).toLocaleString()}`
          );
        }
      }
    }
    
    // Summary statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_enriched,
        AVG(holder_count) as avg_holders,
        MAX(holder_count) as max_holders,
        AVG(top_holder_percentage) as avg_top_holder,
        COUNT(DISTINCT creator) as unique_creators
      FROM tokens
      WHERE helius_updated_at IS NOT NULL
    `;
    
    const stats = await db.query(statsQuery);
    const stat = stats.rows[0];
    
    console.log('\n📈 Enrichment Statistics:');
    console.log(`   Total Enriched Tokens: ${stat.total_enriched}`);
    console.log(`   Average Holders: ${parseFloat(stat.avg_holders || 0).toFixed(0)}`);
    console.log(`   Maximum Holders: ${stat.max_holders || 0}`);
    console.log(`   Average Top Holder: ${parseFloat(stat.avg_top_holder || 0).toFixed(2)}%`);
    console.log(`   Unique Creators: ${stat.unique_creators}`);
    
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

viewEnrichedTokens().catch(console.error);