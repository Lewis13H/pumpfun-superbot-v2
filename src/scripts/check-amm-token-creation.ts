import { UnifiedDBService } from '../services/db/unified-db-service';
import { container } from '../container';
import { logger } from '../utils/logger';
import { sql } from 'kysely';

interface AMMTradeCheck {
  mint_address: string;
  trade_count: number;
  first_trade: Date;
  last_trade: Date;
  token_exists: boolean;
  graduated_to_amm: boolean | null;
  has_amm_pool: boolean;
  token_symbol: string | null;
  token_name: string | null;
}

async function checkAMMTokenCreation() {
  logger.info('🔍 Checking AMM token creation and graduation status...');
  
  const dbService = container.resolve<UnifiedDBService>('dbService');
  const db = dbService.getDb();

  try {
    // 1. Get all AMM trades from the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    logger.info(`\n📊 Analyzing AMM trades since ${oneHourAgo.toISOString()}\n`);

    // Query for AMM trades grouped by mint address
    const ammTrades = await db
      .selectFrom('trades_unified')
      .select([
        'mint_address',
        sql<string>`COUNT(*)`.as('trade_count'),
        sql<Date>`MIN(timestamp)`.as('first_trade'),
        sql<Date>`MAX(timestamp)`.as('last_trade')
      ])
      .where('is_amm', '=', true)
      .where('timestamp', '>=', oneHourAgo)
      .groupBy('mint_address')
      .orderBy(sql`COUNT(*) DESC`)
      .execute();

    logger.info(`Found ${ammTrades.length} unique tokens with AMM trades\n`);

    if (ammTrades.length === 0) {
      logger.info('No AMM trades found in the last hour');
      return;
    }

    // 2. Check each token's status
    const results: AMMTradeCheck[] = [];
    
    for (const trade of ammTrades) {
      // Check if token exists in tokens_unified
      const token = await db
        .selectFrom('tokens_unified')
        .select([
          'mint_address',
          'symbol',
          'name',
          'graduated_to_amm',
          'amm_pool_address'
        ])
        .where('mint_address', '=', trade.mint_address)
        .executeTakeFirst();

      results.push({
        mint_address: trade.mint_address,
        trade_count: parseInt(trade.trade_count),
        first_trade: trade.first_trade,
        last_trade: trade.last_trade,
        token_exists: !!token,
        graduated_to_amm: token?.graduated_to_amm ?? null,
        has_amm_pool: !!token?.amm_pool_address,
        token_symbol: token?.symbol ?? null,
        token_name: token?.name ?? null
      });
    }

    // 3. Analyze results
    const missingTokens = results.filter(r => !r.token_exists);
    const notGraduated = results.filter(r => r.token_exists && !r.graduated_to_amm);
    const graduatedNoPool = results.filter(r => r.graduated_to_amm && !r.has_amm_pool);
    const properlySetup = results.filter(r => r.token_exists && r.graduated_to_amm && r.has_amm_pool);

    // 4. Display results
    logger.info('='.repeat(80));
    logger.info('📋 SUMMARY');
    logger.info('='.repeat(80));
    logger.info(`Total tokens with AMM trades: ${results.length}`);
    logger.info(`✅ Properly setup (exists, graduated, has pool): ${properlySetup.length}`);
    logger.info(`❌ Missing from tokens_unified: ${missingTokens.length}`);
    logger.info(`⚠️  Exists but not graduated: ${notGraduated.length}`);
    logger.info(`⚠️  Graduated but no pool address: ${graduatedNoPool.length}`);
    logger.info('');

    // Show missing tokens
    if (missingTokens.length > 0) {
      logger.info('='.repeat(80));
      logger.info('❌ TOKENS WITH AMM TRADES BUT MISSING FROM tokens_unified');
      logger.info('='.repeat(80));
      for (const missing of missingTokens) {
        logger.info(`\nMint: ${missing.mint_address}`);
        logger.info(`  AMM Trades: ${missing.trade_count}`);
        logger.info(`  First Trade: ${missing.first_trade.toISOString()}`);
        logger.info(`  Last Trade: ${missing.last_trade.toISOString()}`);
      }
    }

    // Show tokens not marked as graduated
    if (notGraduated.length > 0) {
      logger.info('\n' + '='.repeat(80));
      logger.info('⚠️  TOKENS WITH AMM TRADES BUT NOT MARKED AS GRADUATED');
      logger.info('='.repeat(80));
      for (const token of notGraduated) {
        logger.info(`\nMint: ${token.mint_address}`);
        logger.info(`  Symbol: ${token.token_symbol || 'Unknown'}`);
        logger.info(`  Name: ${token.token_name || 'Unknown'}`);
        logger.info(`  AMM Trades: ${token.trade_count}`);
        logger.info(`  First Trade: ${token.first_trade.toISOString()}`);
        logger.info(`  Last Trade: ${token.last_trade.toISOString()}`);
      }
    }

    // Show graduated tokens without pool address
    if (graduatedNoPool.length > 0) {
      logger.info('\n' + '='.repeat(80));
      logger.info('⚠️  GRADUATED TOKENS WITHOUT AMM POOL ADDRESS');
      logger.info('='.repeat(80));
      for (const token of graduatedNoPool) {
        logger.info(`\nMint: ${token.mint_address}`);
        logger.info(`  Symbol: ${token.token_symbol || 'Unknown'}`);
        logger.info(`  Name: ${token.token_name || 'Unknown'}`);
        logger.info(`  AMM Trades: ${token.trade_count}`);
      }
    }

    // 5. Check for recent bonding curve trades on graduated tokens
    logger.info('\n' + '='.repeat(80));
    logger.info('🔄 CHECKING FOR BC TRADES ON GRADUATED TOKENS');
    logger.info('='.repeat(80));
    
    const graduatedMints = results
      .filter(r => r.graduated_to_amm)
      .map(r => r.mint_address);

    if (graduatedMints.length > 0) {
      const bcTradesOnGraduated = await db
        .selectFrom('trades_unified')
        .select([
          'mint_address',
          sql<string>`COUNT(*)`.as('trade_count')
        ])
        .where('is_amm', '=', false)
        .where('timestamp', '>=', oneHourAgo)
        .where('mint_address', 'in', graduatedMints)
        .groupBy('mint_address')
        .execute();

      if (bcTradesOnGraduated.length > 0) {
        logger.info('\n⚠️  Found BC trades on graduated tokens (this should not happen):');
        for (const trade of bcTradesOnGraduated) {
          const token = results.find(r => r.mint_address === trade.mint_address);
          logger.info(`  ${token?.token_symbol || 'Unknown'} (${trade.mint_address}): ${trade.trade_count} BC trades`);
        }
      } else {
        logger.info('\n✅ No BC trades found on graduated tokens (correct behavior)');
      }
    }

    // 6. Sample properly setup tokens
    if (properlySetup.length > 0) {
      logger.info('\n' + '='.repeat(80));
      logger.info('✅ SAMPLE OF PROPERLY SETUP TOKENS (max 5)');
      logger.info('='.repeat(80));
      for (const token of properlySetup.slice(0, 5)) {
        logger.info(`\n${token.token_symbol || 'Unknown'} (${token.token_name || 'Unknown'})`);
        logger.info(`  Mint: ${token.mint_address}`);
        logger.info(`  AMM Trades: ${token.trade_count}`);
        logger.info(`  Graduated: ✓`);
        logger.info(`  Has Pool: ✓`);
      }
    }

    // 7. Recommendations
    logger.info('\n' + '='.repeat(80));
    logger.info('💡 RECOMMENDATIONS');
    logger.info('='.repeat(80));
    
    if (missingTokens.length > 0) {
      logger.info('\n1. Missing Tokens Issue:');
      logger.info('   - AMM trades are being recorded but tokens are not being created');
      logger.info('   - Check if AMM monitor is calling tokenService.updateOrCreateToken()');
      logger.info('   - Verify AMM trade handler is processing token creation properly');
    }

    if (notGraduated.length > 0) {
      logger.info('\n2. Graduation Status Issue:');
      logger.info('   - Tokens with AMM trades should be marked as graduated');
      logger.info('   - Run graduation fixer: npm run fix-graduated-tokens');
      logger.info('   - Check if graduation detection is working in monitors');
    }

    if (graduatedNoPool.length > 0) {
      logger.info('\n3. Pool Address Issue:');
      logger.info('   - Graduated tokens are missing AMM pool addresses');
      logger.info('   - Check if pool addresses are being extracted from AMM transactions');
    }

  } catch (error) {
    logger.error('Error checking AMM token creation:', error);
  } finally {
    await dbService.destroy();
  }
}

// Run the check
checkAMMTokenCreation().catch(console.error);