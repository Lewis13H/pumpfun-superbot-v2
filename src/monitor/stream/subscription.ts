// src/monitor/stream/subscription.ts

import { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { PUMP_PROGRAM } from '../constants';

export class SubscriptionBuilder {
  /**
   * Build subscription request for pump.fun transactions
   */
  static buildPumpFunSubscription() {
    return {
      accounts: {},
      slots: {},
      transactions: {
        pumpfun: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [PUMP_PROGRAM],
          accountExclude: [],
          accountRequired: [],
        },
      },
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: CommitmentLevel.CONFIRMED,
    };
  }
}
