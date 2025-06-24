import { Pool } from 'pg';
import { PublicKey } from '@solana/web3.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

interface DbToken {
  address: string;
  bonding_curve: string;
  symbol: string;
  name: string;
  creator: string;
  created_at: string;
  current_price?: number;
  current_mcap?: number;
}

interface SolscanTokenData {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  supply: string;
  holder_count?: number;
}

interface ValidationResult {
  token_address: string;
  database_data: DbToken;
  solscan_data: SolscanTokenData | null;
  validation_errors: string[];
  bonding_curve_valid: boolean;
  token_address_valid: boolean;
  creator_address_valid: boolean;
}

class TokenDataValidator {
  private pool: Pool;
  private delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    });
  }

  /**
   * Validate if a string is a valid Solana public key
   */
  private isValidPublicKey(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }
    
    try {
      new PublicKey(address);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Fetch token data from Solscan API
   */
  private async fetchSolscanData(tokenAddress: string): Promise<SolscanTokenData | null> {
    try {
      // Add delay to respect rate limits
      await this.delay(1000);
      
      const response = await fetch(`https://public-api.solscan.io/token/meta?tokenAddress=${tokenAddress}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        console.log(`❌ Solscan API error for ${tokenAddress}: ${response.status}`);
        return null;
      }

      const data = await response.json();
      return {
        address: tokenAddress,
        symbol: data.symbol || '',
        name: data.name || '',
        decimals: data.decimals || 9,
        supply: data.supply || '0',
        holder_count: data.holder_count
      };
    } catch (error) {
      console.log(`❌ Error fetching Solscan data for ${tokenAddress}:`, error.message);
      return null;
    }
  }

  /**
   * Get tokens from database with latest price data
   */
  private async getTokensFromDatabase(limit: number = 20): Promise<DbToken[]> {
    const query = `
      SELECT 
        t.address,
        t.bonding_curve,
        t.symbol,
        t.name,
        t.creator,
        t.created_at,
        p.price_usd as current_price,
        p.market_cap_usd as current_mcap
      FROM tokens t
      LEFT JOIN LATERAL (
        SELECT price_usd, market_cap_usd 
        FROM price_updates 
        WHERE token = t.address 
        ORDER BY time DESC 
        LIMIT 1
      ) p ON true
      WHERE NOT t.archived
      ORDER BY t.created_at DESC
      LIMIT $1
    `;

    const result = await this.pool.query(query, [limit]);
    return result.rows;
  }

  /**
   * Validate a single token
   */
  private async validateToken(dbToken: DbToken): Promise<ValidationResult> {
    const errors: string[] = [];
    
    // Validate addresses
    const tokenAddressValid = this.isValidPublicKey(dbToken.address);
    const bondingCurveValid = this.isValidPublicKey(dbToken.bonding_curve);
    const creatorAddressValid = this.isValidPublicKey(dbToken.creator);

    if (!tokenAddressValid) {
      errors.push(`Invalid token address: ${dbToken.address}`);
    }
    if (!bondingCurveValid) {
      errors.push(`Invalid bonding curve address: ${dbToken.bonding_curve}`);
    }
    if (!creatorAddressValid) {
      errors.push(`Invalid creator address: ${dbToken.creator}`);
    }

    // Check address lengths
    if (dbToken.address && dbToken.address.length !== 44) {
      errors.push(`Token address wrong length: ${dbToken.address.length} chars (should be 44)`);
    }
    if (dbToken.bonding_curve && dbToken.bonding_curve.length !== 44) {
      errors.push(`Bonding curve wrong length: ${dbToken.bonding_curve.length} chars (should be 44)`);
    }

    // Fetch Solscan data for comparison
    let solscanData: SolscanTokenData | null = null;
    if (tokenAddressValid) {
      solscanData = await this.fetchSolscanData(dbToken.address);
    }

    // Compare with Solscan data
    if (solscanData) {
      if (dbToken.symbol && solscanData.symbol && 
          dbToken.symbol.toLowerCase() !== solscanData.symbol.toLowerCase()) {
        errors.push(`Symbol mismatch: DB="${dbToken.symbol}" vs Solscan="${solscanData.symbol}"`);
      }
      if (dbToken.name && solscanData.name && 
          dbToken.name.toLowerCase() !== solscanData.name.toLowerCase()) {
        errors.push(`Name mismatch: DB="${dbToken.name}" vs Solscan="${solscanData.name}"`);
      }
    }

    return {
      token_address: dbToken.address,
      database_data: dbToken,
      solscan_data: solscanData,
      validation_errors: errors,
      bonding_curve_valid: bondingCurveValid,
      token_address_valid: tokenAddressValid,
      creator_address_valid: creatorAddressValid
    };
  }

  /**
   * Run comprehensive validation test
   */
  async runValidationTest(limit: number = 20): Promise<void> {
    console.log('🔍 Starting Token Data Validation Test');
    console.log('=====================================\n');

    try {
      // Fetch tokens from database
      console.log(`📊 Fetching ${limit} most recent tokens from database...`);
      const dbTokens = await this.getTokensFromDatabase(limit);
      console.log(`✅ Found ${dbTokens.length} tokens in database\n`);

      if (dbTokens.length === 0) {
        console.log('❌ No tokens found in database');
        return;
      }

      // Validate each token
      const results: ValidationResult[] = [];
      let validTokens = 0;
      let invalidTokens = 0;

      for (let i = 0; i < dbTokens.length; i++) {
        const token = dbTokens[i];
        console.log(`[${i + 1}/${dbTokens.length}] Validating ${token.symbol || 'Unknown'} (${token.address.substring(0, 8)}...)`);
        
        const result = await this.validateToken(token);
        results.push(result);

        if (result.validation_errors.length === 0) {
          validTokens++;
          console.log(`  ✅ Valid`);
        } else {
          invalidTokens++;
          console.log(`  ❌ ${result.validation_errors.length} error(s)`);
        }
      }

      // Print detailed results
      console.log('\n📋 DETAILED VALIDATION RESULTS');
      console.log('===============================\n');

      results.forEach((result, index) => {
        const token = result.database_data;
        console.log(`${index + 1}. ${token.symbol || 'Unknown'} (${token.address})`);
        console.log(`   Created: ${new Date(token.created_at).toLocaleString()}`);
        console.log(`   Bonding Curve: ${token.bonding_curve}`);
        console.log(`   Creator: ${token.creator}`);
        
        if (result.validation_errors.length > 0) {
          console.log(`   ❌ ERRORS:`);
          result.validation_errors.forEach(error => {
            console.log(`      • ${error}`);
          });
        }

        if (result.solscan_data) {
          console.log(`   📍 Solscan Data:`);
          console.log(`      Symbol: ${result.solscan_data.symbol}`);
          console.log(`      Name: ${result.solscan_data.name}`);
          console.log(`      Supply: ${result.solscan_data.supply}`);
        } else if (result.token_address_valid) {
          console.log(`   ⚠️  Could not fetch Solscan data`);
        }

        if (token.current_price) {
          console.log(`   💰 Current Price: $${token.current_price}`);
          console.log(`   📈 Market Cap: $${token.current_mcap?.toLocaleString()}`);
        }

        console.log('');
      });

      // Summary
      console.log('📊 VALIDATION SUMMARY');
      console.log('====================');
      console.log(`Total tokens tested: ${results.length}`);
      console.log(`Valid tokens: ${validTokens} (${((validTokens / results.length) * 100).toFixed(1)}%)`);
      console.log(`Invalid tokens: ${invalidTokens} (${((invalidTokens / results.length) * 100).toFixed(1)}%)`);

      // Address validation breakdown
      const validTokenAddresses = results.filter(r => r.token_address_valid).length;
      const validBondingCurves = results.filter(r => r.bonding_curve_valid).length;
      const validCreators = results.filter(r => r.creator_address_valid).length;

      console.log('\n🔑 ADDRESS VALIDATION BREAKDOWN:');
      console.log(`Valid token addresses: ${validTokenAddresses}/${results.length}`);
      console.log(`Valid bonding curves: ${validBondingCurves}/${results.length}`);
      console.log(`Valid creator addresses: ${validCreators}/${results.length}`);

      // Common issues
      const commonIssues = new Map<string, number>();
      results.forEach(result => {
        result.validation_errors.forEach(error => {
          const key = error.split(':')[0];
          commonIssues.set(key, (commonIssues.get(key) || 0) + 1);
        });
      });

      if (commonIssues.size > 0) {
        console.log('\n⚠️  COMMON ISSUES:');
        Array.from(commonIssues.entries())
          .sort((a, b) => b[1] - a[1])
          .forEach(([issue, count]) => {
            console.log(`${issue}: ${count} occurrence(s)`);
          });
      }

      // Recommendations
      console.log('\n💡 RECOMMENDATIONS:');
      if (validBondingCurves < results.length) {
        console.log('• Fix bonding curve address parsing - this is likely causing your current error');
      }
      if (validTokenAddresses < results.length) {
        console.log('• Validate token address parsing from transaction data');
      }
      if (invalidTokens > validTokens) {
        console.log('• Consider implementing stronger validation during token ingestion');
      }
      console.log('• Add database constraints to prevent invalid addresses from being stored');

    } catch (error) {
      console.error('❌ Test failed:', error);
    } finally {
      await this.pool.end();
    }
  }

  /**
   * Test specific problematic tokens mentioned in the error
   */
  async testProblematicTokens(): Promise<void> {
    console.log('🔍 Testing Problematic Tokens from Error Log');
    console.log('============================================\n');

    const problematicSymbols = ['Citrus', 'PB', 'realpepe', 'TNI'];
    
    try {
      for (const symbol of problematicSymbols) {
        console.log(`Testing ${symbol}...`);
        
        const query = `
          SELECT address, bonding_curve, symbol, name, creator 
          FROM tokens 
          WHERE symbol ILIKE $1 
          ORDER BY created_at DESC 
          LIMIT 1
        `;
        
        const result = await this.pool.query(query, [symbol]);
        
        if (result.rows.length > 0) {
          const token = result.rows[0];
          console.log(`  Address: ${token.address}`);
          console.log(`  Bonding Curve: ${token.bonding_curve}`);
          console.log(`  Valid Token Address: ${this.isValidPublicKey(token.address)}`);
          console.log(`  Valid Bonding Curve: ${this.isValidPublicKey(token.bonding_curve)}`);
          console.log(`  Address Length: ${token.address?.length || 0}`);
          console.log(`  Bonding Curve Length: ${token.bonding_curve?.length || 0}`);
        } else {
          console.log(`  ❌ Token with symbol "${symbol}" not found in database`);
        }
        console.log('');
      }
    } catch (error) {
      console.error('❌ Error testing problematic tokens:', error);
    }
  }
}

// Main execution
async function main() {
  const validator = new TokenDataValidator();
  
  // Test the specific problematic tokens first
  await validator.testProblematicTokens();
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Run full validation test
  await validator.runValidationTest(20);
}

// Export for use as module or run directly
if (require.main === module) {
  main().catch(console.error);
}

export { TokenDataValidator };