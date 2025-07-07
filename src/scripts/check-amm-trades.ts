#!/usr/bin/env node
import { Client } from 'pg';
import dotenv from 'dotenv';
import { format } from 'date-fns';

// Load environment variables
dotenv.config();

async function checkAMMTrades() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await client.connect();
    console.log('Connected to database\n');

    // Query for most recent 10 AMM trades
    const recentTradesQuery = `
      SELECT 
        t.created_at as timestamp,
        t.trade_type,
        t.sol_amount,
        t.token_amount,
        t.price_sol,
        t.price_usd,
        t.market_cap_usd,
        t.virtual_sol_reserves,
        t.virtual_token_reserves,
        tok.symbol,
        tok.name,
        LEFT(t.mint_address, 8) || '...' || RIGHT(t.mint_address, 4) as mint_short,
        LEFT(t.user_address, 8) || '...' || RIGHT(t.user_address, 4) as trader_short
      FROM trades_unified t
      LEFT JOIN tokens_unified tok ON t.mint_address = tok.mint_address
      WHERE t.program = 'amm'
      ORDER BY t.created_at DESC
      LIMIT 10
    `;

    const recentTrades = await client.query(recentTradesQuery);
    
    console.log('=== Most Recent 10 AMM Trades ===\n');
    
    if (recentTrades.rows.length === 0) {
      console.log('No AMM trades found in the database.\n');
    } else {
      recentTrades.rows.forEach((trade, index) => {
        console.log(`Trade #${index + 1}:`);
        console.log(`  Timestamp: ${format(new Date(trade.timestamp), 'yyyy-MM-dd HH:mm:ss')}`);
        console.log(`  Token: ${trade.symbol || 'Unknown'} (${trade.name || 'Unknown'})`);
        console.log(`  Mint: ${trade.mint_short}`);
        console.log(`  Type: ${trade.trade_type}`);
        console.log(`  Trader: ${trade.trader_short}`);
        console.log(`  SOL Amount: ${(parseFloat(trade.sol_amount) / 1e9).toFixed(6)} SOL`);
        console.log(`  Token Amount: ${(parseFloat(trade.token_amount) / 1e6).toLocaleString()}`);
        console.log(`  Price (SOL): ${parseFloat(trade.price_sol).toFixed(9)} SOL`);
        console.log(`  Price (USD): $${parseFloat(trade.price_usd).toFixed(9)}`);
        console.log(`  Market Cap: $${parseFloat(trade.market_cap_usd).toLocaleString()}`);
        console.log(`  Virtual SOL Reserves: ${trade.virtual_sol_reserves ? (parseFloat(trade.virtual_sol_reserves) / 1e9).toFixed(6) : 'NULL'} SOL`);
        console.log(`  Virtual Token Reserves: ${trade.virtual_token_reserves ? (parseFloat(trade.virtual_token_reserves) / 1e6).toLocaleString() : 'NULL'}`);
        console.log('');
      });
    }

    // Count AMM trades in the last hour
    const hourlyCountQuery = `
      SELECT 
        COUNT(*) as total_trades,
        COUNT(DISTINCT mint_address) as unique_tokens,
        COUNT(DISTINCT user_address) as unique_traders,
        SUM(CASE WHEN trade_type = 'buy' THEN 1 ELSE 0 END) as buy_count,
        SUM(CASE WHEN trade_type = 'sell' THEN 1 ELSE 0 END) as sell_count,
        AVG(sol_amount) as avg_sol_amount,
        SUM(sol_amount) as total_sol_volume,
        MIN(created_at) as first_trade,
        MAX(created_at) as last_trade
      FROM trades_unified
      WHERE program = 'amm'
        AND created_at > NOW() - INTERVAL '1 hour'
    `;

    const hourlyStats = await client.query(hourlyCountQuery);
    const stats = hourlyStats.rows[0];

    console.log('=== AMM Trading Stats (Last Hour) ===\n');
    console.log(`Total Trades: ${stats.total_trades}`);
    console.log(`Unique Tokens: ${stats.unique_tokens}`);
    console.log(`Unique Traders: ${stats.unique_traders}`);
    console.log(`Buy Orders: ${stats.buy_count}`);
    console.log(`Sell Orders: ${stats.sell_count}`);
    console.log(`Average Trade Size: ${stats.avg_sol_amount ? (parseFloat(stats.avg_sol_amount) / 1e9).toFixed(4) : '0'} SOL`);
    console.log(`Total Volume: ${stats.total_sol_volume ? (parseFloat(stats.total_sol_volume) / 1e9).toFixed(2) : '0'} SOL`);
    
    if (stats.first_trade && stats.last_trade) {
      console.log(`\nTime Range:`);
      console.log(`  First Trade: ${format(new Date(stats.first_trade), 'yyyy-MM-dd HH:mm:ss')}`);
      console.log(`  Last Trade: ${format(new Date(stats.last_trade), 'yyyy-MM-dd HH:mm:ss')}`);
    }

    // Check for NULL virtual reserves (potential migration issues)
    const nullReservesQuery = `
      SELECT COUNT(*) as null_count
      FROM trades_unified
      WHERE program = 'amm'
        AND (virtual_sol_reserves IS NULL OR virtual_token_reserves IS NULL)
        AND created_at > NOW() - INTERVAL '24 hours'
    `;

    const nullReserves = await client.query(nullReservesQuery);
    console.log(`\n=== Data Quality Check ===`);
    console.log(`AMM trades with NULL reserves (last 24h): ${nullReserves.rows[0].null_count}`);

    // Show data type info for virtual reserves columns
    const columnInfoQuery = `
      SELECT column_name, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_name = 'trades_unified'
        AND column_name IN ('virtual_sol_reserves', 'virtual_token_reserves')
      ORDER BY column_name
    `;

    const columnInfo = await client.query(columnInfoQuery);
    console.log(`\n=== Column Information ===`);
    columnInfo.rows.forEach(col => {
      console.log(`${col.column_name}: ${col.data_type}` + 
        (col.numeric_precision ? ` (precision: ${col.numeric_precision}, scale: ${col.numeric_scale})` : ''));
    });

  } catch (error) {
    console.error('Error checking AMM trades:', error);
  } finally {
    await client.end();
  }
}

// Run the check
checkAMMTrades().catch(console.error);