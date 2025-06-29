#!/usr/bin/env tsx
/**
 * Check Shyft Schema
 * Lists available tables and their fields
 */

import 'dotenv/config';
import { ShyftGraphQLClient } from '../src/services/graphql-client';
import chalk from 'chalk';
import { gql } from 'graphql-request';

const SCHEMA_QUERY = gql`
  query IntrospectionQuery {
    __schema {
      queryType {
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

async function main() {
  console.log(chalk.cyan.bold('📋 Checking Shyft GraphQL Schema'));
  console.log(chalk.gray('─'.repeat(80)));
  
  const client = ShyftGraphQLClient.getInstance();
  
  try {
    const result = await client.query(SCHEMA_QUERY, {});
    
    // Get all query fields
    const fields = result.__schema.queryType.fields;
    
    // Filter for relevant tables
    const relevantTables = fields.filter(f => 
      f.name.includes('spl') || 
      f.name.includes('token') || 
      f.name.includes('Token') ||
      f.name.includes('account') ||
      f.name.includes('Account')
    );
    
    console.log(chalk.yellow('\nToken/Account related tables:'));
    relevantTables.forEach(table => {
      console.log(chalk.white(`  ${table.name}`), chalk.gray(`(${table.type.kind})`));
    });
    
    // Look for pump-related tables
    const pumpTables = fields.filter(f => 
      f.name.includes('pump') || 
      f.name.includes('amm')
    );
    
    console.log(chalk.yellow('\nPump/AMM related tables:'));
    pumpTables.forEach(table => {
      console.log(chalk.white(`  ${table.name}`), chalk.gray(`(${table.type.kind})`));
    });
    
    // Check if there's a generic account table
    const accountTables = fields.filter(f => 
      f.name.toLowerCase().includes('account') && 
      !f.name.includes('_by_pk') && 
      !f.name.includes('_aggregate')
    );
    
    console.log(chalk.yellow('\nAccount tables:'));
    accountTables.forEach(table => {
      console.log(chalk.white(`  ${table.name}`));
    });
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  }
}

main().catch(console.error);