import { Pool } from 'pg';
import { PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';

dotenv.config();

interface BondingCurveIssue {
  token_address: string;
  symbol: string;
  bonding_curve: string;
  issue_type: string;
  issue_description: string;
  suggested_fix?: string;
}

class BondingCurveDiagnostic {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    });
  }

  /**
   * Check if string is a valid base58 encoded public key
   */
  private isValidPublicKey(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }
    
    // Check length first (Solana addresses are 44 chars in base58)
    if (address.length !== 44) {
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
   * Analyze bonding curve issues in the database
   */
  async diagnoseBondingCurveIssues(): Promise<BondingCurveIssue[]> {
    console.log('🔍 Analyzing Bonding Curve Issues in Database...\n');

    const query = `
      SELECT 
        address as token_address,
        symbol,
        bonding_curve,
        LENGTH(bonding_curve) as bc_length,
        created_at
      FROM tokens 
      WHERE NOT archived
      ORDER BY created_at DESC
      LIMIT 100
    `;

    const result = await this.pool.query(query);
    const issues: BondingCurveIssue[] = [];

    for (const row of result.rows) {
      const { token_address, symbol, bonding_curve, bc_length } = row;
      
      // Check for null/empty bonding curve
      if (!bonding_curve) {
        issues.push({
          token_address,
          symbol: symbol || 'Unknown',
          bonding_curve: bonding_curve || 'NULL',
          issue_type: 'NULL_OR_EMPTY',
          issue_description: 'Bonding curve address is null or empty'
        });
        continue;
      }

      // Check for wrong length
      if (bc_length !== 44) {
        issues.push({
          token_address,
          symbol: symbol || 'Unknown',
          bonding_curve,
          issue_type: 'WRONG_LENGTH',
          issue_description: `Bonding curve address has ${bc_length} characters (should be 44)`,
          suggested_fix: bc_length < 44 ? 'Address might be truncated' : 'Address might have extra characters'
        });
        continue;
      }

      // Check for invalid base58
      if (!this.isValidPublicKey(bonding_curve)) {
        issues.push({
          token_address,
          symbol: symbol || 'Unknown',
          bonding_curve,
          issue_type: 'INVALID_BASE58',
          issue_description: 'Bonding curve address is not valid base58',
          suggested_fix: 'Check source data parsing logic'
        });
        continue;
      }

      // Check for suspicious patterns
      if (bonding_curve.includes('...')) {
        issues.push({
          token_address,
          symbol: symbol || 'Unknown',
          bonding_curve,
          issue_type: 'TRUNCATED',
          issue_description: 'Bonding curve appears to be truncated (contains "...")',
          suggested_fix: 'Check parsing logic for full address extraction'
        });
      }
    }

    return issues;
  }

  /**
   * Get statistics about bonding curve validity
   */
  async getBondingCurveStats(): Promise<void> {
    console.log('📊 Bonding Curve Statistics');
    console.log('===========================\n');

    const stats = await this.pool.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(bonding_curve) as has_bonding_curve,
        COUNT(*) - COUNT(bonding_curve) as missing_bonding_curve,
        COUNT(CASE WHEN LENGTH(bonding_curve) = 44 THEN 1 END) as correct_length,
        COUNT(CASE WHEN LENGTH(bonding_curve) != 44 AND bonding_curve IS NOT NULL THEN 1 END) as wrong_length,
        AVG(LENGTH(bonding_curve)) as avg_length
      FROM tokens 
      WHERE NOT archived
    `);

    const row = stats.rows[0];
    console.log(`Total tokens: ${row.total_tokens}`);
    console.log(`Has bonding curve: ${row.has_bonding_curve} (${((row.has_bonding_curve / row.total_tokens) * 100).toFixed(1)}%)`);
    console.log(`Missing bonding curve: ${row.missing_bonding_curve}`);
    console.log(`Correct length (44 chars): ${row.correct_length}`);
    console.log(`Wrong length: ${row.wrong_length}`);
    console.log(`Average bonding curve length: ${parseFloat(row.avg_length).toFixed(1)}`);
    console.log('');
  }

  /**
   * Test specific tokens that are failing
   */
  async testFailingTokens(): Promise<void> {
    console.log('🚨 Testing Tokens Mentioned in Error Log');
    console.log('=========================================\n');

    const failingSymbols = ['Citrus', 'PB', 'realpepe', 'TNI'];
    
    for (const symbol of failingSymbols) {
      const result = await this.pool.query(`
        SELECT address, bonding_curve, symbol, name, LENGTH(bonding_curve) as bc_length
        FROM tokens 
        WHERE symbol ILIKE $1 
        ORDER BY created_at DESC 
        LIMIT 1
      `, [symbol]);

      if (result.rows.length > 0) {
        const token = result.rows[0];
        console.log(`${symbol}:`);
        console.log(`  Token Address: ${token.address}`);
        console.log(`  Bonding Curve: ${token.bonding_curve || 'NULL'}`);
        console.log(`  BC Length: ${token.bc_length || 0}`);
        console.log(`  Valid Token Address: ${this.isValidPublicKey(token.address)}`);
        console.log(`  Valid Bonding Curve: ${token.bonding_curve ? this.isValidPublicKey(token.bonding_curve) : false}`);
        
        // Check for common issues
        if (!token.bonding_curve) {
          console.log(`  ❌ ISSUE: Bonding curve is NULL`);
        } else if (token.bc_length !== 44) {
          console.log(`  ❌ ISSUE: Wrong length (${token.bc_length} chars)`);
        } else if (!this.isValidPublicKey(token.bonding_curve)) {
          console.log(`  ❌ ISSUE: Invalid base58 encoding`);
        } else {
          console.log(`  ✅ Bonding curve appears valid`);
        }
        console.log('');
      } else {
        console.log(`${symbol}: Not found in database\n`);
      }
    }
  }

  /**
   * Check for pattern in how bonding curves are being stored
   */
  async analyzeBondingCurvePatterns(): Promise<void> {
    console.log('🔍 Analyzing Bonding Curve Patterns');
    console.log('===================================\n');

    // Check for common patterns in invalid bonding curves
    const patterns = await this.pool.query(`
      SELECT 
        bonding_curve,
        COUNT(*) as count,
        LENGTH(bonding_curve) as length,
        MIN(created_at) as first_seen,
        MAX(created_at) as last_seen
      FROM tokens 
      WHERE bonding_curve IS NOT NULL 
        AND (LENGTH(bonding_curve) != 44 OR bonding_curve LIKE '%...%')
      GROUP BY bonding_curve, LENGTH(bonding_curve)
      ORDER BY count DESC
      LIMIT 10
    `);

    if (patterns.rows.length > 0) {
      console.log('Most common invalid bonding curve patterns:');
      patterns.rows.forEach((row, index) => {
        console.log(`${index + 1}. "${row.bonding_curve}" (length: ${row.length}, count: ${row.count})`);
        console.log(`   First seen: ${new Date(row.first_seen).toLocaleString()}`);
        console.log(`   Last seen: ${new Date(row.last_seen).toLocaleString()}`);
      });
    } else {
      console.log('No common invalid patterns found.');
    }
    console.log('');
  }

  /**
   * Generate SQL to fix common bonding curve issues
   */
  async generateFixSQL(): Promise<void> {
    console.log('🔧 Generated SQL Fixes');
    console.log('======================\n');

    console.log('-- 1. Find tokens with null bonding curves:');
    console.log(`SELECT address, symbol FROM tokens WHERE bonding_curve IS NULL LIMIT 10;`);
    console.log('');

    console.log('-- 2. Find tokens with wrong length bonding curves:');
    console.log(`SELECT address, symbol, bonding_curve, LENGTH(bonding_curve) FROM tokens WHERE LENGTH(bonding_curve) != 44 AND bonding_curve IS NOT NULL LIMIT 10;`);
    console.log('');

    console.log('-- 3. Count problematic tokens:');
    console.log(`SELECT 
  'NULL bonding curves' as issue,
  COUNT(*) as count
FROM tokens 
WHERE bonding_curve IS NULL AND NOT archived
UNION ALL
SELECT 
  'Wrong length bonding curves' as issue,
  COUNT(*) as count
FROM tokens 
WHERE LENGTH(bonding_curve) != 44 AND bonding_curve IS NOT NULL AND NOT archived;`);
    console.log('');

    console.log('-- 4. Archive tokens with invalid bonding curves (CAREFUL - TEST FIRST):');
    console.log(`-- UPDATE tokens SET archived = true WHERE bonding_curve IS NULL OR LENGTH(bonding_curve) != 44;`);
    console.log('');
  }

  /**
   * Run complete diagnostic
   */
  async runDiagnostic(): Promise<void> {
    console.log('🔧 Bonding Curve Diagnostic Tool');
    console.log('================================\n');

    try {
      // Get basic stats
      await this.getBondingCurveStats();

      // Test specific failing tokens
      await this.testFailingTokens();

      // Analyze patterns
      await this.analyzeBondingCurvePatterns();

      // Find specific issues
      const issues = await this.diagnoseBondingCurveIssues();

      if (issues.length > 0) {
        console.log('🚨 IDENTIFIED ISSUES');
        console.log('===================\n');

        // Group issues by type
        const issuesByType = new Map<string, BondingCurveIssue[]>();
        issues.forEach(issue => {
          if (!issuesByType.has(issue.issue_type)) {
            issuesByType.set(issue.issue_type, []);
          }
          issuesByType.get(issue.issue_type)!.push(issue);
        });

        // Display issues by type
        issuesByType.forEach((issueList, type) => {
          console.log(`${type} (${issueList.length} tokens):`);
          issueList.slice(0, 5).forEach(issue => {
            console.log(`  • ${issue.symbol} (${issue.token_address.substring(0, 8)}...): ${issue.issue_description}`);
            if (issue.suggested_fix) {
              console.log(`    💡 ${issue.suggested_fix}`);
            }
          });
          if (issueList.length > 5) {
            console.log(`    ... and ${issueList.length - 5} more`);
          }
          console.log('');
        });

        console.log(`Total issues found: ${issues.length}\n`);
      } else {
        console.log('✅ No bonding curve issues found!\n');
      }

      // Generate fix SQL
      await this.generateFixSQL();

      // Recommendations
      console.log('💡 RECOMMENDATIONS');
      console.log('==================');
      console.log('1. Check your token parsing logic in the transaction parser');
      console.log('2. Ensure bonding curve addresses are extracted fully from transaction data');
      console.log('3. Add validation before inserting tokens into database');
      console.log('4. Consider archiving tokens with invalid bonding curves');
      console.log('5. Add database constraints to prevent invalid addresses');

    } catch (error) {
      console.error('❌ Diagnostic failed:', error);
    } finally {
      await this.pool.end();
    }
  }
}

// Quick validation function for testing individual addresses
function validateAddress(address: string): void {
  console.log(`Testing address: "${address}"`);
  console.log(`Length: ${address?.length || 0}`);
  console.log(`Type: ${typeof address}`);
  console.log(`Truthy: ${!!address}`);
  
  try {
    new PublicKey(address);
    console.log(`✅ Valid Solana public key`);
  } catch (error) {
    console.log(`❌ Invalid: ${error.message}`);
  }
  console.log('');
}

// Main execution
async function main() {
  const diagnostic = new BondingCurveDiagnostic();
  
  // Test some addresses if provided as command line args
  const testAddresses = process.argv.slice(2);
  if (testAddresses.length > 0) {
    console.log('🧪 Testing Provided Addresses');
    console.log('=============================\n');
    testAddresses.forEach(validateAddress);
    console.log('='.repeat(50) + '\n');
  }
  
  await diagnostic.runDiagnostic();
}

// Export for use as module or run directly
if (require.main === module) {
  main().catch(console.error);
}

export { BondingCurveDiagnostic, validateAddress };