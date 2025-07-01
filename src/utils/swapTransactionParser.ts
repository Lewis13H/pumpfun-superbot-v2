export function parseSwapTransactionOutput(parsedInstruction: any, transaction: any): any {
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    let output = {};

    const swapInstruction = parsedInstruction.instructions.pumpAmmIxs.find(
        (instruction: any) => instruction.name === 'buy' || instruction.name === 'sell'
    );

    if (!swapInstruction) {
        return;
    }

    const signerPubkey = swapInstruction.accounts.find((account: any) => account.name === 'user')?.pubkey;

    const swapAmount = swapInstruction.name === 'sell'
        ? swapInstruction.args?.base_amount_in
        : swapInstruction.args?.base_amount_out;

    const determineOutAmount = () => {
        if (!transaction.meta.innerInstructions) {
            console.error("No inner instructions found in transaction");
            return null;
        }
         const transferChecked = parsedInstruction.inner_ixs.find(
         (instruction: any) =>
         instruction.name === 'transferChecked' && instruction.args?.amount !== swapAmount).args?.amount;
          return transferChecked;
    };
    const determineBuySellEvent = () => {
        const baseMintPubkey = swapInstruction.accounts.find((account: any) => account.name === 'base_mint')?.pubkey;
        const quoteMintPubkey = swapInstruction.accounts.find((account: any) => account.name === 'quote_mint')?.pubkey;

        if (!baseMintPubkey || !quoteMintPubkey) {
            console.error("Base or quote mint not found in swap accounts");
            return { type: "Unknown", mint: null };
        }

        // Determine which is SOL and which is the token
        const isBaseSol = baseMintPubkey === SOL_MINT;
        const mint = isBaseSol ? quoteMintPubkey : baseMintPubkey;
        
        // CRITICAL FIX: The pump.fun AMM uses a specific pattern:
        // - For token->SOL swaps (sells): instruction is 'sell' when base is token
        // - For SOL->token swaps (buys): instruction is 'buy' when base is token
        // When base is SOL, the logic is inverted
        let eventType;
        if (isBaseSol) {
            // When base is SOL, 'buy' means buying SOL (selling token)
            // and 'sell' means selling SOL (buying token)
            eventType = swapInstruction.name === 'buy' ? "Sell" : "Buy";
        } else {
            // When base is token, 'buy' means buying token
            // and 'sell' means selling token
            eventType = swapInstruction.name === 'buy' ? "Buy" : "Sell";
        }

        return { type: eventType, mint };
    };

    const buySellEvent = determineBuySellEvent();
  const base_amount_in = swapInstruction.name === 'sell'
        ? swapInstruction.args?.base_amount_in
        : swapInstruction.args?.base_amount_out;
     
        const amountIn = swapInstruction.name === 'buy'
        ? determineOutAmount()
        : base_amount_in;

    const amountOut = swapInstruction.name === 'sell'
        ? determineOutAmount()
        : base_amount_in;
    const transactionEvent = {
        type: buySellEvent.type,
        user: signerPubkey,
        mint: buySellEvent.mint,
        out_amount: amountOut,
        in_amount: amountIn, 
    };


    output = {
        ...transaction,
        meta: {
            ...transaction.meta,
            innerInstructions: parsedInstruction.inner_ixs,
        },
        transaction: {
            ...transaction.transaction,
            message: {
                ...transaction.transaction.message,
                compiledInstructions: parsedInstruction.instructions,
            },
        }
    };

    return { output, transactionEvent };
}