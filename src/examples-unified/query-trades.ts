#!/usr/bin/env node
/**
 * Query and analyze trades from the unified system
 */

import 'dotenv/config';
import { Pool } from 'pg';
import chalk from 'chalk';

interface TradeQueryOptions {
  mintAddress?: string;
  program?: 'bonding_curve' | 'amm_pool';
  limit?: number;
  minMarketCap?: number;
}

async function queryTrades(options: TradeQueryOptions = {}) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    let query = `
      SELECT 
        t.signature,
        t.mint_address,
        t.program,
        t.trade_type,
        t.price_usd,
        t.market_cap_usd,
        t.created_at,
        tk.symbol,
        tk.name
      FROM trades_unified t
      LEFT JOIN tokens_unified tk ON t.mint_address = tk.mint_address
      WHERE 1=1
    `;
    
    const params: any[] = [];
    let paramCount = 0;

    if (options.mintAddress) {
      query += ` AND t.mint_address = $${++paramCount}`;
      params.push(options.mintAddress);
    }

    if (options.program) {
      query += ` AND t.program = $${++paramCount}`;
      params.push(options.program);
    }

    if (options.minMarketCap) {
      query += ` AND t.market_cap_usd >= $${++paramCount}`;
      params.push(options.minMarketCap);
    }

    query += ` ORDER BY t.created_at DESC`;
    
    if (options.limit) {
      query += ` LIMIT $${++paramCount}`;
      params.push(options.limit);
    } else {
      query += ` LIMIT 50`;
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      console.log(chalk.gray('No trades found matching criteria.\n'));
      return;
    }

    console.log(chalk.cyan.bold('\n📊 Recent Trades\n'));

    // Group trades by token for better display
    const tokenGroups = new Map<string, typeof result.rows>();
    
    for (const trade of result.rows) {
      const key = trade.mint_address;
      if (!tokenGroups.has(key)) {
        tokenGroups.set(key, []);
      }
      tokenGroups.get(key)!.push(trade);
    }

    for (const [mintAddress, trades] of tokenGroups) {
      const firstTrade = trades[0];
      const tokenName = firstTrade.symbol || 'Unknown';
      const fullName = firstTrade.name || 'No name';
      
      console.log(chalk.cyan('━'.repeat(80)));
      console.log(chalk.white.bold(`${tokenName} (${fullName})`));
      console.log(chalk.gray(`Mint: ${mintAddress}`));
      console.log();

      for (const trade of trades) {
        const tradeIcon = trade.trade_type === 'buy' ? '🟢' : '🔴';
        const programName = trade.program === 'bonding_curve' ? 'Pump.fun' : 'Pump.swap';
        
        console.log(
          `${tradeIcon} ${chalk.white(new Date(trade.created_at).toLocaleTimeString())} ` +
          `[${chalk.yellow(programName)}] ` +
          `${trade.trade_type.toUpperCase()} ` +
          `@ $${trade.price_usd.toFixed(6)} ` +
          `(MC: ${chalk.green(`$${Number(trade.market_cap_usd).toLocaleString()}`)})`
        );
      }
      console.log();
    }

    // Show summary statistics
    const stats = await pool.query(`
      SELECT 
        program,
        trade_type,
        COUNT(*) as count,
        AVG(market_cap_usd) as avg_mcap,
        MAX(market_cap_usd) as max_mcap
      FROM trades_unified
      WHERE created_at > NOW() - INTERVAL '1 hour'
      GROUP BY program, trade_type
      ORDER BY program, trade_type
    `);

    console.log(chalk.cyan('━'.repeat(80)));
    console.log(chalk.white.bold('\n📈 Last Hour Statistics:\n'));

    let lastProgram = '';
    for (const stat of stats.rows) {
      if (stat.program !== lastProgram) {
        if (lastProgram) console.log();
        const programName = stat.program === 'bonding_curve' ? 'Pump.fun' : 'Pump.swap';
        console.log(chalk.yellow.bold(programName + ':'));
        lastProgram = stat.program;
      }
      
      console.log(
        `  ${stat.trade_type === 'buy' ? 'Buys' : 'Sells'}: ${chalk.green(stat.count)} ` +
        `(Avg MC: $${Number(stat.avg_mcap).toLocaleString()}, ` +
        `Max: $${Number(stat.max_mcap).toLocaleString()})`
      );
    }

  } catch (error) {
    console.error(chalk.red('Error querying trades:'), error);
  } finally {
    await pool.end();
  }
}

// Command line interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: TradeQueryOptions = {
    limit: 50
  };

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--mint':
      case '-m':
        options.mintAddress = args[++i];
        break;
      case '--program':
      case '-p':
        options.program = args[++i] as 'bonding_curve' | 'amm_pool';
        break;
      case '--limit':
      case '-l':
        options.limit = parseInt(args[++i]);
        break;
      case '--min-mcap':
        options.minMarketCap = parseInt(args[++i]);
        break;
      case '--help':
      case '-h':
        console.log(`
Usage: npm run query-trades [options]

Options:
  -m, --mint <address>     Filter by mint address
  -p, --program <type>     Filter by program (bonding_curve or amm_pool)
  -l, --limit <number>     Limit results (default: 50)
  --min-mcap <number>      Minimum market cap in USD
  -h, --help              Show help
        `);
        process.exit(0);
    }
  }

  queryTrades(options).catch(console.error);
}

export { queryTrades };