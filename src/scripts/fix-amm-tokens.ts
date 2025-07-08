import { Container } from 'typedi';
import { DatabaseService } from '../services/database.service';
import { UnifiedDBService } from '../services/db/unified-db.service';
import { AmmReservesFetcher } from '../services/amm/amm-reserves-fetcher';
import { PriceCalculator } from '../services/pricing/price-calculator';
import { SolPriceService } from '../services/pricing/sol-price-service';
import { Connection } from '@solana/web3.js';
import { setTimeout } from 'timers/promises';
import { config } from '../config';

async function main() {
  console.log('Starting AMM token fix process...\n');

  // Initialize services
  const db = Container.get(DatabaseService);
  const unifiedDB = Container.get(UnifiedDBService);
  const connection = new Connection(config.rpcEndpoint);
  const solPriceService = Container.get(SolPriceService);
  const priceCalculator = Container.get(PriceCalculator);
  const reservesFetcher = new AmmReservesFetcher(connection);

  await db.initialize();

  try {
    // Get current SOL price
    const solPrice = await solPriceService.getSolPrice();
    console.log(`Current SOL price: $${solPrice.toFixed(2)}\n`);

    // Find unique mint addresses from AMM trades in the last 24 hours
    console.log('Finding AMM tokens from recent trades...');
    const query = `
      SELECT DISTINCT mint_address 
      FROM trades_unified 
      WHERE trading_venue = 'AMM' 
        AND timestamp > NOW() - INTERVAL '24 hours'
        AND mint_address IS NOT NULL
      ORDER BY mint_address
    `;
    
    const result = await db.query(query);
    const mintAddresses = result.rows.map(row => row.mint_address);
    
    console.log(`Found ${mintAddresses.length} unique AMM tokens from recent trades\n`);

    let created = 0;
    let updated = 0;
    let failed = 0;
    let skipped = 0;

    // Process each mint address
    for (let i = 0; i < mintAddresses.length; i++) {
      const mintAddress = mintAddresses[i];
      console.log(`[${i + 1}/${mintAddresses.length}] Processing ${mintAddress}...`);

      try {
        // Check if token exists in database
        const tokenQuery = `
          SELECT mint_address, current_market_cap_usd, graduated_to_amm
          FROM tokens_unified
          WHERE mint_address = $1
        `;
        const tokenResult = await db.query(tokenQuery, [mintAddress]);
        const existingToken = tokenResult.rows[0];

        // Fetch current reserves
        console.log('  Fetching AMM reserves...');
        const reserves = await reservesFetcher.fetchReserves(mintAddress);
        
        if (!reserves) {
          console.log('  ❌ Failed to fetch reserves');
          failed++;
          continue;
        }

        // Calculate price and market cap
        const tokenPriceSOL = priceCalculator.calculateAmmPrice(reserves);
        const tokenPriceUSD = tokenPriceSOL * solPrice;
        const marketCapSOL = tokenPriceSOL * reserves.tokenSupply;
        const marketCapUSD = marketCapSOL * solPrice;

        console.log(`  Token reserves: ${reserves.tokenReserves.toLocaleString()}`);
        console.log(`  SOL reserves: ${reserves.solReserves.toFixed(4)} SOL`);
        console.log(`  Price: ${tokenPriceSOL.toFixed(9)} SOL ($${tokenPriceUSD.toFixed(9)})`);
        console.log(`  Market cap: ${marketCapSOL.toFixed(2)} SOL ($${marketCapUSD.toLocaleString()})`);

        if (!existingToken) {
          // Create new token entry
          console.log('  Creating new token entry...');
          
          await unifiedDB.upsertToken({
            mintAddress,
            symbol: 'UNKNOWN',
            name: 'Unknown Token',
            image: null,
            description: null,
            twitter: null,
            telegram: null,
            discord: null,
            website: null,
            metadataScore: 0,
            isVerified: false,
            currentPriceSOL: tokenPriceSOL,
            currentPriceUSD: tokenPriceUSD,
            currentMarketCapSOL: marketCapSOL,
            currentMarketCapUSD: marketCapUSD,
            currentLiquiditySOL: reserves.solReserves,
            currentLiquidityUSD: reserves.solReserves * solPrice,
            latestBondingCurveProgress: 100,
            bondingCurveComplete: true,
            latestVirtualTokenReserves: reserves.tokenReserves.toString(),
            latestVirtualSolReserves: reserves.solReserves.toString(),
            graduatedToAmm: true,
            graduatedAt: new Date(),
            totalSupply: reserves.tokenSupply.toString(),
            updateSource: 'AMM_FIX_SCRIPT'
          });

          console.log('  ✅ Created new token entry');
          created++;
        } else if (existingToken.current_market_cap_usd === 0 || !existingToken.graduated_to_amm) {
          // Update existing token
          console.log('  Updating existing token...');
          
          await unifiedDB.updateTokenPricing(mintAddress, {
            currentPriceSOL: tokenPriceSOL,
            currentPriceUSD: tokenPriceUSD,
            currentMarketCapSOL: marketCapSOL,
            currentMarketCapUSD: marketCapUSD,
            currentLiquiditySOL: reserves.solReserves,
            currentLiquidityUSD: reserves.solReserves * solPrice,
            latestVirtualTokenReserves: reserves.tokenReserves.toString(),
            latestVirtualSolReserves: reserves.solReserves.toString(),
            updateSource: 'AMM_FIX_SCRIPT'
          });

          // Mark as graduated if not already
          if (!existingToken.graduated_to_amm) {
            await unifiedDB.markTokenAsGraduated(mintAddress);
            console.log('  Marked token as graduated');
          }

          console.log('  ✅ Updated token data');
          updated++;
        } else {
          console.log('  ⏭️  Token already has valid data, skipping');
          skipped++;
        }

        // Small delay to avoid rate limiting
        await setTimeout(100);

      } catch (error) {
        console.error(`  ❌ Error processing token: ${error}`);
        failed++;
      }
    }

    // Summary
    console.log('\n=== Summary ===');
    console.log(`Total tokens processed: ${mintAddresses.length}`);
    console.log(`Created: ${created}`);
    console.log(`Updated: ${updated}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Failed: ${failed}`);

    // Show some sample fixed tokens
    if (created + updated > 0) {
      console.log('\nSample of fixed tokens:');
      const sampleQuery = `
        SELECT 
          symbol,
          name,
          mint_address,
          current_market_cap_usd,
          current_price_usd,
          latest_virtual_sol_reserves
        FROM tokens_unified
        WHERE graduated_to_amm = true
          AND update_source = 'AMM_FIX_SCRIPT'
          AND current_market_cap_usd > 0
        ORDER BY current_market_cap_usd DESC
        LIMIT 5
      `;
      
      const sampleResult = await db.query(sampleQuery);
      
      sampleResult.rows.forEach((token, index) => {
        console.log(`\n${index + 1}. ${token.symbol} (${token.name})`);
        console.log(`   Mint: ${token.mint_address}`);
        console.log(`   Market Cap: $${parseFloat(token.current_market_cap_usd).toLocaleString()}`);
        console.log(`   Price: $${parseFloat(token.current_price_usd).toFixed(9)}`);
        console.log(`   SOL Reserves: ${parseFloat(token.latest_virtual_sol_reserves).toFixed(4)} SOL`);
      });
    }

  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await db.close();
    process.exit(0);
  }
}

// Run the script
main().catch(console.error);