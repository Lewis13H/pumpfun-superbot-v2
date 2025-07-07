-- Migration to fix AMM reserves columns that exceed BIGINT range
-- Changes BIGINT columns to NUMERIC to handle arbitrarily large values

-- Update tokens_unified table
ALTER TABLE tokens_unified 
  ALTER COLUMN latest_virtual_sol_reserves TYPE NUMERIC,
  ALTER COLUMN latest_virtual_token_reserves TYPE NUMERIC;

-- Update trades_unified table  
ALTER TABLE trades_unified
  ALTER COLUMN virtual_sol_reserves TYPE NUMERIC,
  ALTER COLUMN virtual_token_reserves TYPE NUMERIC;

-- Update amm_pool_states table
ALTER TABLE amm_pool_states
  ALTER COLUMN virtual_sol_reserves TYPE NUMERIC,
  ALTER COLUMN virtual_token_reserves TYPE NUMERIC;