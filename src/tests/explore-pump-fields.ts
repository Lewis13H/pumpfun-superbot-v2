#!/usr/bin/env tsx

/**
 * Explore pump_BondingCurve fields
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

// Get fields of pump_BondingCurve
const GET_FIELDS = gql`
  query GetPumpBondingCurveFields {
    __type(name: "pump_BondingCurve") {
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

// Try a simple query to see what data we get
const SIMPLE_QUERY = gql`
  query GetSomeBondingCurves {
    pump_BondingCurve(limit: 2) {
      pubkey
      _updatedAt
    }
  }
`;

async function explorePumpFields() {
  console.log(chalk.cyan.bold('\n🔍 Exploring pump_BondingCurve fields\n'));
  
  try {
    // Get field information
    console.log(chalk.blue('Getting pump_BondingCurve fields...'));
    const fieldsResult = await client.request(GET_FIELDS);
    
    if (fieldsResult.__type && fieldsResult.__type.fields) {
      console.log(chalk.green(`\nFound ${fieldsResult.__type.fields.length} fields:`));
      fieldsResult.__type.fields.forEach((field: any) => {
        const typeName = field.type.ofType?.name || field.type.name || 'unknown';
        console.log(`  ${chalk.yellow(field.name)} → ${chalk.gray(typeName)}`);
      });
    }
    
    // Try to get some data
    console.log(chalk.blue('\n\nTrying to fetch some bonding curves...'));
    const dataResult = await client.request(SIMPLE_QUERY);
    console.log(chalk.green('\nSuccess! Got data:'));
    console.log(JSON.stringify(dataResult, null, 2));
    
  } catch (error: any) {
    console.error(chalk.red('\nError:'), error.response || error);
  }
}

// Run exploration
explorePumpFields()
  .then(() => {
    console.log(chalk.green('\n✅ Exploration complete'));
    process.exit(0);
  })
  .catch(error => {
    console.error(chalk.red('\n❌ Exploration failed:'), error);
    process.exit(1);
  });