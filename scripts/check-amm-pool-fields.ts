#!/usr/bin/env tsx
/**
 * Check pump_fun_amm_Pool fields
 */

import 'dotenv/config';
import { ShyftGraphQLClient } from '../src/services/graphql-client';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('Checking pump_fun_amm_Pool fields...\n'));
  
  const client = ShyftGraphQLClient.getInstance();
  
  try {
    // First try to get a sample pool
    const sampleQuery = `
      query GetSamplePool {
        pump_fun_amm_Pool(limit: 1) {
          __typename
        }
      }
    `;
    
    const sampleResult = await client.query(sampleQuery, {});
    console.log(chalk.green('✅ pump_fun_amm_Pool exists'));
    
    // Try common field combinations
    const fieldTests = [
      ['pubkey', 'tokenMint', '_updatedAt'],
      ['pubkey', 'token_mint', '_updatedAt'],
      ['pubkey', 'mint', '_updatedAt'],
      ['pubkey', 'virtualSolReserves', 'virtualTokenReserves'],
      ['pubkey', 'virtual_sol_reserves', 'virtual_token_reserves'],
      ['pubkey', 'solReserves', 'tokenReserves'],
      ['pubkey', 'baseReserves', 'quoteReserves'],
      ['pubkey', 'lpSupply'],
      ['pubkey', 'lp_supply'],
      ['pubkey', 'liquidity'],
    ];
    
    console.log(chalk.yellow('\nTesting field combinations...'));
    
    for (const fields of fieldTests) {
      try {
        const query = `
          query TestFields {
            pump_fun_amm_Pool(limit: 1) {
              ${fields.join('\n              ')}
            }
          }
        `;
        const result = await client.query(query, {});
        
        if (result.pump_fun_amm_Pool?.length > 0) {
          console.log(chalk.green(`✅ Fields work: ${fields.join(', ')}`));
          console.log(chalk.gray('   Sample data:'), JSON.stringify(result.pump_fun_amm_Pool[0], null, 2));
          break;
        }
      } catch (error) {
        // Try next combination
      }
    }
    
    // Try to get schema introspection for this type
    console.log(chalk.yellow('\n\nTrying type introspection...'));
    const typeQuery = `
      query GetType {
        __type(name: "pump_fun_amm_Pool") {
          name
          fields {
            name
            type {
              name
              kind
            }
          }
        }
      }
    `;
    
    try {
      const typeResult = await client.query(typeQuery, {});
      if (typeResult.__type?.fields) {
        console.log(chalk.green('\nAvailable fields for pump_fun_amm_Pool:'));
        typeResult.__type.fields.forEach(field => {
          console.log(chalk.white(`  - ${field.name} (${field.type.name || field.type.kind})`));
        });
      }
    } catch (e) {
      console.log(chalk.red('Could not introspect type'));
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  }
}

main().catch(console.error);