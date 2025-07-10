import axios from 'axios';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE_URL = 'http://localhost:3001/api';

interface TokenWithHolderData {
  mint_address: string;
  symbol: string;
  name: string;
  latest_market_cap_usd: number;
  holder_score: number;
  holder_count?: number;
  top_10_percentage?: number;
  bot_percentage?: number;
  sniper_percentage?: number;
  developer_percentage?: number;
}

async function searchTokensWithHolderData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('Searching for tokens with complete holder analysis data...\n');

    // Method 1: Direct database query for tokens with holder scores
    const dbResult = await pool.query(`
      SELECT DISTINCT
        t.mint_address,
        t.symbol,
        t.name,
        t.latest_market_cap_usd,
        t.image_uri,
        hs.holder_score,
        hs.total_holders as holder_count,
        hs.top_10_percentage,
        hs.score_breakdown,
        hs.snapshot_time
      FROM tokens_unified t
      JOIN holder_snapshots hs ON t.mint_address = hs.mint_address
      WHERE hs.holder_score IS NOT NULL
        AND hs.total_holders > 0
      ORDER BY hs.snapshot_time DESC
      LIMIT 20
    `);

    console.log('=== Tokens with Holder Analysis (Database) ===');
    console.log(`Found ${dbResult.rows.length} tokens\n`);

    // Group by token to show only latest snapshot
    const tokenMap = new Map<string, any>();
    dbResult.rows.forEach(row => {
      if (!tokenMap.has(row.mint_address)) {
        tokenMap.set(row.mint_address, row);
      }
    });

    let index = 1;
    for (const [mint, token] of tokenMap) {
      console.log(`${index}. ${token.symbol} (${token.name})`);
      console.log(`   Mint: ${mint}`);
      console.log(`   Market Cap: $${token.latest_market_cap_usd?.toLocaleString() || 'N/A'}`);
      console.log(`   Holder Score: ${token.holder_score}/300`);
      console.log(`   Holder Count: ${token.holder_count}`);
      console.log(`   Top 10%: ${token.top_10_percentage}%`);
      if (token.score_breakdown) {
        console.log(`   Bot Penalty: ${token.score_breakdown.botPenalty || 0}`);
        console.log(`   Sniper Penalty: ${token.score_breakdown.sniperPenalty || 0}`);
      }
      console.log(`   Last Analysis: ${new Date(token.snapshot_time).toLocaleString()}\n`);
      index++;
      if (index > 10) break;
    }

    // Method 2: Try API endpoints
    console.log('\n=== Checking API Endpoints ===\n');

    try {
      // Check main tokens endpoint
      const tokensResponse = await axios.get(`${API_BASE_URL}/tokens`);
      const tokensWithScores = tokensResponse.data.filter((t: any) => t.holder_score !== null);
      
      console.log(`Main tokens endpoint: Found ${tokensWithScores.length} tokens with holder scores`);
      
      if (tokensWithScores.length > 0) {
        console.log('\nTop 5 tokens by holder score:');
        tokensWithScores
          .sort((a: any, b: any) => (b.holder_score || 0) - (a.holder_score || 0))
          .slice(0, 5)
          .forEach((token: any, i: number) => {
            console.log(`${i + 1}. ${token.symbol} - Score: ${token.holder_score}/300 - Market Cap: $${token.latest_market_cap_usd?.toLocaleString()}`);
          });
      }
    } catch (error) {
      console.log('Could not fetch from API:', error.message);
    }

    // Method 3: Check holder analysis specific endpoint
    try {
      const topTokensResponse = await axios.get(`${API_BASE_URL}/holder-analysis/top-tokens?limit=10`);
      console.log('\n/holder-analysis/top-tokens response:', JSON.stringify(topTokensResponse.data, null, 2));
    } catch (error) {
      console.log('Holder analysis endpoint error:', error.message);
    }

    // Show example tokens for testing
    if (tokenMap.size > 0) {
      const exampleTokens = Array.from(tokenMap.values()).slice(0, 3);
      console.log('\n=== Example Tokens for Testing ===');
      console.log('You can use these mint addresses to test holder analysis features:\n');
      
      exampleTokens.forEach((token, i) => {
        console.log(`${i + 1}. ${token.symbol}`);
        console.log(`   Mint: ${token.mint_address}`);
        console.log(`   Holder Score: ${token.holder_score}/300\n`);
      });
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

// Run the search
searchTokensWithHolderData();