#!/usr/bin/env tsx

/**
 * Test GraphQL Token Metadata Queries
 * Check if we can fetch token metadata via GraphQL instead of REST API
 */

import chalk from 'chalk';
import { config } from 'dotenv';
import { ShyftGraphQLClient } from '../src/services/graphql-client';

config();

async function testGraphQLMetadata() {
  console.log(chalk.cyan.bold('\n🔍 Testing GraphQL Token Metadata Queries\n'));
  
  const client = ShyftGraphQLClient.getInstance();
  
  // Test token mint addresses (replace with actual tokens)
  const testMints = [
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC for testing
    '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', // A pump.fun token
  ];
  
  try {
    // Test 1: Try standard Solana token metadata query
    console.log(chalk.yellow('1️⃣ Testing standard token metadata query...'));
    
    try {
      const tokenQuery = `
        query GetTokenMetadata($mints: [String!]) {
          Token(
            where: { pubkey: { _in: $mints } }
          ) {
            pubkey
            name
            symbol
            decimals
            supply
            mint_authority
            freeze_authority
            is_initialized
            metadata {
              name
              symbol
              uri
              seller_fee_basis_points
              creators {
                address
                share
                verified
              }
            }
          }
        }
      `;
      
      const result = await client.query(tokenQuery, { mints: testMints });
      console.log(chalk.green('✅ Token metadata query successful!'));
      console.log(result);
      
    } catch (error) {
      console.log(chalk.red('❌ Standard token query failed'));
    }
    
    // Test 2: Try Metaplex metadata query
    console.log(chalk.yellow('\n2️⃣ Testing Metaplex metadata query...'));
    
    try {
      const metaplexQuery = `
        query GetMetaplexMetadata($mints: [String!]) {
          Metadata(
            where: { mint: { _in: $mints } }
          ) {
            pubkey
            mint
            name
            symbol
            uri
            seller_fee_basis_points
            creators {
              address
              share
              verified
            }
            primary_sale_happened
            is_mutable
            edition_nonce
            token_standard
            collection {
              key
              verified
            }
          }
        }
      `;
      
      const result = await client.query(metaplexQuery, { mints: testMints });
      console.log(chalk.green('✅ Metaplex metadata query successful!'));
      console.log(result);
      
    } catch (error) {
      console.log(chalk.red('❌ Metaplex query failed'));
    }
    
    // Test 3: Try SPL Token query
    console.log(chalk.yellow('\n3️⃣ Testing SPL Token query...'));
    
    try {
      const splQuery = `
        query GetSPLTokens($mints: [String!]) {
          spl_Token(
            where: { pubkey: { _in: $mints } }
          ) {
            pubkey
            decimals
            supply
            mint_authority
            freeze_authority
          }
        }
      `;
      
      const result = await client.query(splQuery, { mints: testMints });
      console.log(chalk.green('✅ SPL Token query successful!'));
      console.log(result);
      
    } catch (error) {
      console.log(chalk.red('❌ SPL Token query failed'));
    }
    
    // Test 4: Try Fungible Asset query
    console.log(chalk.yellow('\n4️⃣ Testing Fungible Asset query...'));
    
    try {
      const fungibleQuery = `
        query GetFungibleAssets($mints: [String!]) {
          FungibleAsset(
            where: { id: { _in: $mints } }
          ) {
            id
            owner
            content {
              metadata {
                name
                symbol
                uri
                description
              }
              json_uri
              files {
                uri
                mime
              }
            }
            compression {
              compressed
              leaf_id
            }
          }
        }
      `;
      
      const result = await client.query(fungibleQuery, { mints: testMints });
      console.log(chalk.green('✅ Fungible Asset query successful!'));
      console.log(result);
      
    } catch (error) {
      console.log(chalk.red('❌ Fungible Asset query failed'));
    }
    
    // Test 5: Try introspection to find metadata types
    console.log(chalk.yellow('\n5️⃣ Looking for metadata-related types...'));
    
    try {
      const introspectionQuery = `
        query FindMetadataTypes {
          __schema {
            types {
              name
              kind
              description
            }
          }
        }
      `;
      
      const result = await client.query(introspectionQuery, {});
      const types = result.__schema?.types || [];
      
      const metadataTypes = types.filter(t => 
        t.name.toLowerCase().includes('metadata') ||
        t.name.toLowerCase().includes('token') ||
        t.name.toLowerCase().includes('asset') ||
        t.name.toLowerCase().includes('fungible')
      );
      
      console.log(chalk.green('\nFound metadata-related types:'));
      metadataTypes.forEach(type => {
        console.log(chalk.white(`  - ${type.name} (${type.kind})`));
        if (type.description) {
          console.log(chalk.gray(`    ${type.description}`));
        }
      });
      
    } catch (error) {
      console.log(chalk.red('❌ Introspection failed'));
    }
    
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error);
  }
  
  console.log(chalk.cyan('\n✨ Test complete!'));
}

// Run the test
testGraphQLMetadata().catch(console.error);