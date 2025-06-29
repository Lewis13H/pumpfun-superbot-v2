#!/usr/bin/env tsx
/**
 * Check GraphQL schema to find correct AMM pool type
 */

import 'dotenv/config';
import { ShyftGraphQLClient } from '../src/services/graphql-client';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('Checking GraphQL Schema...\n'));
  
  const client = ShyftGraphQLClient.getInstance();
  
  try {
    // Try to introspect the schema
    const introspectionQuery = `
      query IntrospectionQuery {
        __schema {
          queryType {
            fields {
              name
              description
            }
          }
        }
      }
    `;
    
    const result = await client.query(introspectionQuery, {});
    
    console.log(chalk.yellow('Available query fields:'));
    const fields = result.__schema?.queryType?.fields || [];
    
    // Look for pump-related fields
    const pumpFields = fields.filter(f => 
      f.name.toLowerCase().includes('pump') || 
      f.name.toLowerCase().includes('swap') ||
      f.name.toLowerCase().includes('amm') ||
      f.name.toLowerCase().includes('pool')
    );
    
    if (pumpFields.length > 0) {
      console.log(chalk.green('\nPump/AMM related fields:'));
      pumpFields.forEach(field => {
        console.log(chalk.white(`  - ${field.name}`));
        if (field.description) {
          console.log(chalk.gray(`    ${field.description}`));
        }
      });
    }
    
    // Show all fields if no pump fields found
    if (pumpFields.length === 0) {
      console.log(chalk.yellow('\nNo pump/AMM fields found. All available fields:'));
      fields.slice(0, 20).forEach(field => {
        console.log(chalk.white(`  - ${field.name}`));
      });
      if (fields.length > 20) {
        console.log(chalk.gray(`  ... and ${fields.length - 20} more`));
      }
    }
    
    // Try a simple query to see what works
    console.log(chalk.blue('\n\nTrying simple queries...'));
    
    // Try bonding curve query
    try {
      const bcQuery = `
        query TestBC {
          pump_BondingCurve(limit: 1) {
            pubkey
          }
        }
      `;
      await client.query(bcQuery, {});
      console.log(chalk.green('✅ pump_BondingCurve exists'));
    } catch (e) {
      console.log(chalk.red('❌ pump_BondingCurve not found'));
    }
    
    // Try different AMM variations
    const ammVariations = [
      'pump_swap_LiquidityPool',
      'pump_LiquidityPool',
      'pumpswap_LiquidityPool',
      'pump_swap_Pool',
      'pump_Pool',
      'pump_AMM',
      'pump_amm',
      'pump_swap',
      'AmmPool',
      'amm_Pool',
    ];
    
    for (const variation of ammVariations) {
      try {
        const query = `
          query Test {
            ${variation}(limit: 1) {
              pubkey
            }
          }
        `;
        await client.query(query, {});
        console.log(chalk.green(`✅ ${variation} exists!`));
        break;
      } catch (e) {
        // Silent fail, try next
      }
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  }
}

main().catch(console.error);