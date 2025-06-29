#!/usr/bin/env node

import 'dotenv/config';
import { db } from '../src/database';
import chalk from 'chalk';

async function main() {
  const signature = '5YUk3Fyzv9C7bmEHH5YbuSTuAYgadqRh8vbh7Qu7FbBEBEHJz4fhPGea8aoiAKrfuHgMT6ncVYsz7pcGMA8kC3Mi';
  
  const result = await db.query(`
    SELECT 
      signature,
      program,
      trade_type,
      user_address,
      mint_address,
      sol_amount,
      token_amount,
      price_sol,
      price_usd,
      market_cap_usd,
      virtual_sol_reserves,
      virtual_token_reserves,
      slot,
      block_time,
      created_at
    FROM trades_unified
    WHERE signature = $1
  `, [signature]);
  
  if (result.rows.length > 0) {
    const trade = result.rows[0];
    console.log(chalk.cyan('Transaction Details:'));
    console.log(chalk.white('Signature:'), trade.signature);
    console.log(chalk.white('Trade Type:'), trade.trade_type);
    console.log(chalk.white('SOL Amount (raw):'), trade.sol_amount);
    console.log(chalk.white('SOL Amount (calculated):'), Number(trade.sol_amount) / 1e9, 'SOL');
    console.log(chalk.white('Token Amount (raw):'), trade.token_amount);
    console.log(chalk.white('Token Amount (calculated):'), Number(trade.token_amount) / 1e6, 'tokens');
    console.log(chalk.white('Price USD:'), trade.price_usd);
    console.log(chalk.white('Market Cap:'), trade.market_cap_usd);
    
    console.log(chalk.yellow('\nExpected from Solscan:'));
    console.log(chalk.white('Trade Type:'), 'SELL');
    console.log(chalk.white('SOL Amount:'), '10.3839 SOL received');
    console.log(chalk.white('Token Amount:'), '212.99 tokens sold');
    console.log(chalk.white('Price per token:'), '$7.1258');
  }
  
  await db.close();
}

main().catch(console.error);