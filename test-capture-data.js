// test-capture-data.js
const Client = require('@triton-one/yellowstone-grpc').default;
const fs = require('fs');

const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

async function captureData() {
  // Add protocol to the endpoint
  const client = new Client(
    'https://grpc.ams.shyft.to:443/',
    'your-grpc-token-here' // PUT YOUR ACTUAL TOKEN
  );

  const stream = await client.subscribe();
  
  let captured = [];
  
  stream.on('data', (data) => {
    console.log('Data type:', data.constructor.name);
    console.log('Data keys:', Object.keys(data));
    
    if (data.transaction) {
      // Log structure
      console.log('Transaction structure:', {
        hasTransaction: !!data.transaction.transaction,
        hasSlot: !!data.slot,
        keys: Object.keys(data.transaction)
      });
      
      captured.push(data);
      console.log(`Captured ${captured.length} transactions`);
      
      // Save after 5 transactions (pump.fun might be less frequent)
      if (captured.length >= 5) {
        fs.writeFileSync(
          'captured-transactions.json', 
          JSON.stringify(captured, null, 2)
        );
        console.log('Saved to captured-transactions.json');
        process.exit(0);
      }
    }
  });

  stream.on('error', (error) => {
    console.error('Stream error:', error);
  });

  // Send subscription
  const request = {
    accounts: {},
    slots: {},
    transactions: {
      pumpFun: {
        vote: false,
        failed: false,
        accountInclude: [PUMP_PROGRAM],
        accountExclude: [],
        accountRequired: []
      }
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    commitment: 2 // CONFIRMED
  };

  stream.write(request, (err) => {
    if (err) {
      console.error('Write error:', err);
    } else {
      console.log('Subscription sent');
    }
  });
}

captureData().catch(console.error);