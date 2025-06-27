import { BorshAccountsCoder } from "@coral-xyz/anchor";
import * as fs from 'fs';
import * as path from 'path';
import { bnLayoutFormatter, convertBase64ToBase58 } from "./base-encoding";
import { fixIdlForAnchor } from "./idl-fixer";

const rawIdl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'idls', 'pump_amm_0.1.0.json'), "utf8"));
const program_idl = fixIdlForAnchor(rawIdl);

const coder = new BorshAccountsCoder(program_idl);

export function parsedAccountData(data: any) {
  if (!data || !data.account || !data.account.account) {
    throw new Error("Invalid data format");
  }

  const dataTx = data.account.account;

  const signature = dataTx.txnSignature ? convertBase64ToBase58(dataTx.txnSignature) : null;
  const pubKey = dataTx.pubkey ? convertBase64ToBase58(dataTx.pubkey) : null;
  const owner = dataTx.owner ? convertBase64ToBase58(dataTx.owner) : null;
  
  let parsedAccount;
  try {
    parsedAccount = coder.decodeAny(dataTx?.data);
    bnLayoutFormatter(parsedAccount);
    
  } catch (error) {
    console.error("Failed to decode pool state:", error);
  }

  return {
    signature,
    pubKey,
    owner,
    parsedAccount
  };
}