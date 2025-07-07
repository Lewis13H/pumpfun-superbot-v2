-- Fix trade amounts to handle large AMM values
-- Convert sol_amount and token_amount from BIGINT to NUMERIC

ALTER TABLE trades_unified 
  ALTER COLUMN sol_amount TYPE NUMERIC,
  ALTER COLUMN token_amount TYPE NUMERIC;

-- Also fix slot column if it's causing issues
ALTER TABLE trades_unified
  ALTER COLUMN slot TYPE NUMERIC;