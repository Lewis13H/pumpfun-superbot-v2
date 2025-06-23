// src/monitor/utils/decode.ts

import { Buffer } from 'buffer';
import { utils } from "@coral-xyz/anchor";

export function decodeTransact(data: any): string {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) {
    return utils.bytes.bs58.encode(data);
  }
  return utils.bytes.bs58.encode(Buffer.from(data, 'base64'));
}

export function decodeBase64ToBuffer(data: string): Buffer {
  return Buffer.from(data, 'base64');
}

export function decodeInstructionData(data: any): Buffer {
  if (typeof data === 'string') {
    return utils.bytes.bs58.decode(data);
  }
  return Buffer.from(data, 'base64');
}
