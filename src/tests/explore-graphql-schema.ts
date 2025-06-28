#!/usr/bin/env tsx

/**
 * Explore Shyft GraphQL Schema
 * Discovers available types and fields
 */

import 'dotenv/config';
import { GraphQLClient } from 'graphql-request';
import { gql } from 'graphql-request';
import chalk from 'chalk';

const GRAPHQL_ENDPOINT = `https://programs.shyft.to/v0/graphql/?api_key=${process.env.SHYFT_API_KEY}&network=mainnet-beta`;

const client = new GraphQLClient(GRAPHQL_ENDPOINT, {
  headers: {
    'Content-Type': 'application/json',
  },
});

// Introspection query to get schema
const INTROSPECTION_QUERY = gql`
  query IntrospectionQuery {
    __schema {
      types {
        name
        kind
        description
        fields {
          name
          type {
            name
            kind
          }
        }
      }
    }
  }
`;

// Simple query to get type names
const GET_TYPE_NAMES = gql`
  query GetTypeNames {
    __schema {
      types {
        name
        kind
      }
    }
  }
`;

async function exploreSchema() {
  console.log(chalk.cyan.bold('\n🔍 Exploring Shyft GraphQL Schema\n'));
  
  try {
    // First, get all type names
    console.log(chalk.blue('Getting all types...'));
    const typesResponse = await client.request(GET_TYPE_NAMES);
    
    // Filter for pump.fun related types
    const pumpTypes = typesResponse.__schema.types.filter((type: any) => 
      type.name.toLowerCase().includes('pump') || 
      type.name.toLowerCase().includes('bonding')
    );
    
    console.log(chalk.green(`\nFound ${pumpTypes.length} pump.fun related types:`));
    pumpTypes.forEach((type: any) => {
      console.log(`  ${chalk.yellow(type.name)} (${type.kind})`);
    });
    
    // Also look for any query root fields
    const queryType = typesResponse.__schema.types.find((type: any) => type.name === 'query_root');
    if (queryType) {
      console.log(chalk.blue('\n\nExploring query_root to find available queries...'));
      
      // Get detailed info about query_root
      const QUERY_ROOT_FIELDS = gql`
        query GetQueryRootFields {
          __type(name: "query_root") {
            name
            fields {
              name
              type {
                name
                kind
                ofType {
                  name
                  kind
                }
              }
            }
          }
        }
      `;
      
      const queryRootResponse = await client.request(QUERY_ROOT_FIELDS);
      const fields = queryRootResponse.__type.fields;
      
      // Filter for pump related fields
      const pumpFields = fields.filter((field: any) => 
        field.name.toLowerCase().includes('pump') || 
        field.name.toLowerCase().includes('bonding') ||
        field.name.toLowerCase().includes('curve')
      );
      
      console.log(chalk.green(`\nFound ${pumpFields.length} pump.fun related query fields:`));
      pumpFields.forEach((field: any) => {
        const typeName = field.type.ofType?.name || field.type.name;
        console.log(`  ${chalk.yellow(field.name)} → ${chalk.gray(typeName)}`);
      });
      
      // Try to find the exact table name
      console.log(chalk.blue('\n\nLooking for account/table queries...'));
      const accountFields = fields.filter((field: any) => 
        field.name.includes('account') || 
        field.name.includes('Account') ||
        field.name === 'pump_fun' ||
        field.name.includes('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') // pump.fun program ID
      );
      
      console.log(chalk.green(`\nFound ${accountFields.length} account-related query fields:`));
      accountFields.forEach((field: any) => {
        const typeName = field.type.ofType?.name || field.type.name;
        console.log(`  ${chalk.yellow(field.name)} → ${chalk.gray(typeName)}`);
      });
    }
    
  } catch (error) {
    console.error(chalk.red('\nError exploring schema:'), error);
  }
}

// Run exploration
exploreSchema()
  .then(() => {
    console.log(chalk.green('\n✅ Schema exploration complete'));
    process.exit(0);
  })
  .catch(error => {
    console.error(chalk.red('\n❌ Schema exploration failed:'), error);
    process.exit(1);
  });