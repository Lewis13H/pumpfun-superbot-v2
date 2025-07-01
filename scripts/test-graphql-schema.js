#!/usr/bin/env node

/**
 * Explore GraphQL schema for pump.fun
 */

const fetch = require('node-fetch');
const chalk = require('chalk');

const GRAPHQL_ENDPOINT = `https://programs.shyft.to/v0/graphql/?api_key=3M9B3EeJTk_1EAuG&network=mainnet-beta`;

async function exploreSchema() {
  console.log(chalk.blue('🧪 Exploring pump.fun GraphQL schema...\n'));
  
  try {
    // Get schema info
    console.log(chalk.yellow('📊 Getting pump.fun schema info...'));
    const schemaQuery = `
      query {
        __type(name: "pump_BondingCurve") {
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
    
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: schemaQuery
      })
    });
    
    const data = await response.json();
    
    if (data.data && data.data.__type) {
      console.log(chalk.green('✅ Found pump_BondingCurve type!'));
      console.log(chalk.cyan('\nAvailable fields:'));
      data.data.__type.fields.forEach(field => {
        console.log(chalk.gray(`  - ${field.name}: ${field.type.name || field.type.kind}`));
      });
    } else {
      console.log(chalk.red('❌ Could not find pump_BondingCurve type'));
      console.log(JSON.stringify(data, null, 2));
    }
    
    // Try a simple query
    console.log(chalk.yellow('\n📊 Testing simple query...'));
    const simpleQuery = `
      query {
        pump_BondingCurve(limit: 2) {
          pubkey
        }
      }
    `;
    
    const simpleResponse = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: simpleQuery
      })
    });
    
    const simpleData = await simpleResponse.json();
    
    if (simpleData.data && simpleData.data.pump_BondingCurve) {
      console.log(chalk.green(`✅ Simple query successful! Found ${simpleData.data.pump_BondingCurve.length} records`));
      simpleData.data.pump_BondingCurve.forEach(item => {
        console.log(chalk.gray(`  - ${item.pubkey}`));
      });
    } else {
      console.log(chalk.red('❌ Simple query failed'));
      console.log(JSON.stringify(simpleData, null, 2));
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
  }
}

// Run exploration
exploreSchema().catch(console.error);