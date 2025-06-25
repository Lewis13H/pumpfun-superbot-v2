import { 
  CommitmentLevel,
  SubscribeRequest,
  SubscribeUpdate 
} from '@triton-one/yellowstone-grpc';
import { PUMP_PROGRAM } from '../utils/constants';
import { StreamClient } from './client';

export async function testMinimalSubscription() {
  console.log('Testing minimal subscription...');
  
  const client = StreamClient.getInstance().getClient();
  
  // Exactly matching Shyft's structure
  const request: SubscribeRequest = {
    accounts: {},
    slots: {},
    transactions: {
      pumpfun: {
        vote: false,
        failed: false,
        accountInclude: [PUMP_PROGRAM],
        accountExclude: [],
        accountRequired: [],
      },
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    accountsDataSlice: [],
    commitment: CommitmentLevel.CONFIRMED,
  };
  
  try {
    const stream = await client.subscribe();
    
    stream.on('data', (data: SubscribeUpdate) => {
      if (data.ping) {
        console.log('Received ping:', data.ping.id);
      }
      if (data.transaction) {
        console.log('Received transaction');
      }
    });
    
    stream.on('error', (error) => {
      console.error('Stream error:', error);
    });
    
    // Send request
    stream.write(request);
    
    console.log('Request sent successfully');
  } catch (error) {
    console.error('Failed to subscribe:', error);
  }
}

// Run if called directly
if (require.main === module) {
  testMinimalSubscription();
}