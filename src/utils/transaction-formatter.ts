import {
  VersionedTransactionResponse,
  PublicKey,
  TransactionSignature,
} from "@solana/web3.js";
import bs58 from 'bs58';

export class TransactionFormatter {
  formTransactionFromJson(
    txData: any,
    timestamp: number
  ): VersionedTransactionResponse {
    try {
      // Handle the nested gRPC transaction structure
      const innerTx = txData.transaction?.transaction || txData;
      
      // Handle signatures - convert Buffers to base58 strings
      let signatures: string[] = [];
      if (innerTx.signatures) {
        signatures = innerTx.signatures.map((sig: any) => {
          if (Buffer.isBuffer(sig)) {
            return bs58.encode(sig);
          }
          return sig;
        });
      } else if (txData.signature) {
        const sig = Buffer.isBuffer(txData.signature) 
          ? bs58.encode(txData.signature) 
          : txData.signature;
        signatures = [sig];
      }

      // Create the formatted transaction response
      const formattedTx: VersionedTransactionResponse = {
        transaction: {
          message: innerTx.message,
          signatures: signatures
        },
        meta: txData.meta || {
          err: null,
          fee: 0,
          innerInstructions: [],
          logMessages: [],
          postBalances: [],
          postTokenBalances: [],
          preBalances: [],
          preTokenBalances: [],
          rewards: [],
          status: { Ok: null }
        },
        version: 0,
        slot: txData.slot || 0,
        blockTime: Math.floor(timestamp / 1000)
      };

      return formattedTx;
    } catch (error) {
      throw new Error(`Failed to format transaction: ${error}`);
    }
  }

  // Helper to extract account keys from different transaction formats
  extractAccountKeys(txData: any): PublicKey[] {
    try {
      const innerTx = txData.transaction?.transaction || txData;
      
      if (innerTx.message?.accountKeys) {
        // Handle Buffer format from gRPC
        return innerTx.message.accountKeys.map((key: any) => {
          if (Buffer.isBuffer(key)) {
            return new PublicKey(key);
          }
          return new PublicKey(key);
        });
      }
      
      return [];
    } catch (error) {
      console.error('Error extracting account keys:', error);
      return [];
    }
  }

  // Helper to get transaction signature
  getSignature(txData: any): TransactionSignature {
    try {
      if (txData.signature) {
        // Handle Buffer signature from gRPC
        if (Buffer.isBuffer(txData.signature)) {
          return bs58.encode(txData.signature);
        }
        return txData.signature;
      }
      
      const innerTx = txData.transaction?.transaction || txData;
      if (innerTx.signatures && innerTx.signatures.length > 0) {
        const signature = innerTx.signatures[0];
        // Handle Buffer signature from gRPC
        if (Buffer.isBuffer(signature)) {
          return bs58.encode(signature);
        }
        return signature;
      }
      
      return '';
    } catch (error) {
      console.error('Error extracting signature:', error);
      return '';
    }
  }
}