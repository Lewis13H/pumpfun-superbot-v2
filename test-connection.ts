#!/usr/bin/env node

import 'dotenv/config';
import Client from '@triton-one/yellowstone-grpc';

async function testConnection() {
  console.log('Testing gRPC connection...');
  console.log('Endpoint:', process.env.SHYFT_GRPC_ENDPOINT);
  console.log('Token:', process.env.SHYFT_GRPC_TOKEN ? 'Set' : 'Not set');
  
  try {
    const client = new Client(
      process.env.SHYFT_GRPC_ENDPOINT || '',
      process.env.SHYFT_GRPC_TOKEN || '',
      undefined
    );
    
    console.log('Client created successfully');
    
    const stream = await client.subscribe();
    console.log('Stream created successfully');
    
    // Minimal request
    const request = {
      accounts: {},
      slots: {},
      transactions: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      commitment: undefined,
    };
    
    stream.write(request);
    console.log('Request sent successfully');
    
    setTimeout(() => {
      stream.end();
      console.log('Test completed');
      process.exit(0);
    }, 2000);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testConnection();