#!/usr/bin/env tsx
/**
 * Check token creation times and ages
 */

import 'dotenv/config';
import { Pool } from 'pg';
import chalk from 'chalk';

async function checkTokenAges() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log(chalk.cyan('📊 Checking token ages...\n'));
    
    // Get statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(token_created_at) as tokens_with_creation_time,
        COUNT(*) FILTER (WHERE token_created_at IS NULL) as tokens_without_creation_time,
        AVG(EXTRACT(EPOCH FROM (NOW() - COALESCE(token_created_at, first_seen_at))) / 3600)::int as avg_age_hours,
        MAX(EXTRACT(EPOCH FROM (NOW() - COALESCE(token_created_at, first_seen_at))) / 3600)::int as max_age_hours,
        MIN(EXTRACT(EPOCH FROM (NOW() - COALESCE(token_created_at, first_seen_at))) / 3600)::int as min_age_hours
      FROM tokens_unified
      WHERE threshold_crossed_at IS NOT NULL
    `;
    
    const stats = await pool.query(statsQuery);
    const s = stats.rows[0];
    
    console.log(chalk.white('Overall Statistics:'));
    console.log(chalk.gray(`Total tokens: ${s.total_tokens}`));
    console.log(chalk.green(`With creation time: ${s.tokens_with_creation_time} (${Math.round(s.tokens_with_creation_time / s.total_tokens * 100)}%)`));
    console.log(chalk.yellow(`Without creation time: ${s.tokens_without_creation_time} (${Math.round(s.tokens_without_creation_time / s.total_tokens * 100)}%)`));
    console.log(chalk.gray(`Average age: ${s.avg_age_hours} hours`));
    console.log(chalk.gray(`Oldest token: ${s.max_age_hours} hours`));
    console.log(chalk.gray(`Newest token: ${s.min_age_hours} hours`));
    
    // Get top tokens and their ages
    const topTokensQuery = `
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd,
        token_created_at,
        first_seen_at,
        CASE 
          WHEN token_created_at IS NOT NULL THEN 'blockchain'
          ELSE 'first_seen'
        END as age_source,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(token_created_at, first_seen_at))) / 3600 as age_hours
      FROM tokens_unified
      WHERE threshold_crossed_at IS NOT NULL
      ORDER BY latest_market_cap_usd DESC NULLS LAST
      LIMIT 20
    `;
    
    const topTokens = await pool.query(topTokensQuery);
    
    console.log(chalk.cyan('\n📈 Top 20 Tokens by Market Cap:'));
    console.log(chalk.gray('Symbol'.padEnd(10) + 'Market Cap'.padEnd(15) + 'Age'.padEnd(15) + 'Source'.padEnd(12) + 'Mint'));
    console.log(chalk.gray('-'.repeat(70)));
    
    for (const token of topTokens.rows) {
      const symbol = (token.symbol || 'Unknown').padEnd(10);
      const mcap = `$${(token.latest_market_cap_usd / 1000).toFixed(1)}k`.padEnd(15);
      const ageHours = Math.floor(token.age_hours);
      const age = ageHours < 24 
        ? `${ageHours}h`.padEnd(15)
        : `${Math.floor(ageHours / 24)}d ${ageHours % 24}h`.padEnd(15);
      const source = token.age_source.padEnd(12);
      const mint = token.mint_address.slice(0, 8) + '...';
      
      const color = token.age_source === 'blockchain' ? chalk.green : chalk.yellow;
      console.log(color(symbol + mcap + age + source + mint));
    }
    
    // Check tokens with large discrepancies
    const discrepancyQuery = `
      SELECT 
        mint_address,
        symbol,
        token_created_at,
        first_seen_at,
        EXTRACT(EPOCH FROM (first_seen_at - token_created_at)) / 3600 as delay_hours
      FROM tokens_unified
      WHERE token_created_at IS NOT NULL
      AND first_seen_at IS NOT NULL
      AND first_seen_at > token_created_at
      ORDER BY delay_hours DESC
      LIMIT 10
    `;
    
    const discrepancies = await pool.query(discrepancyQuery);
    
    if (discrepancies.rows.length > 0) {
      console.log(chalk.cyan('\n⏰ Tokens with Largest Discovery Delays:'));
      console.log(chalk.gray('Symbol'.padEnd(10) + 'Discovery Delay'.padEnd(20) + 'Created'.padEnd(20) + 'First Seen'));
      console.log(chalk.gray('-'.repeat(70)));
      
      for (const token of discrepancies.rows) {
        const symbol = (token.symbol || 'Unknown').padEnd(10);
        const delayHours = Math.floor(token.delay_hours);
        const delay = delayHours < 24
          ? `${delayHours} hours`.padEnd(20)
          : `${Math.floor(delayHours / 24)} days`.padEnd(20);
        const created = new Date(token.token_created_at).toLocaleString().padEnd(20);
        const firstSeen = new Date(token.first_seen_at).toLocaleString();
        
        console.log(chalk.yellow(symbol + delay + created + firstSeen));
      }
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

// Run the script
checkTokenAges().catch(console.error);