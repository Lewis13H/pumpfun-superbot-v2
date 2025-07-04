-- Fix Foreign Key Constraint Issues
-- This script helps resolve foreign key violations when trades reference non-existent tokens

-- First, identify trades that reference non-existent tokens
SELECT COUNT(*) as orphaned_trades 
FROM trades_unified t 
WHERE NOT EXISTS (
    SELECT 1 FROM tokens_unified tok 
    WHERE tok.mint_address = t.mint_address
);

-- Option 1: Create placeholder tokens for orphaned trades
-- This ensures all trades have corresponding token entries
INSERT INTO tokens_unified (
    mint_address,
    symbol,
    name,
    first_seen_at,
    first_seen_slot,
    first_program,
    first_price_sol,
    first_price_usd,
    first_market_cap_usd,
    current_program,
    created_at,
    updated_at
)
SELECT DISTINCT
    t.mint_address,
    'UNKNOWN' as symbol,
    'Unknown Token' as name,
    MIN(t.block_time) as first_seen_at,
    MIN(t.slot) as first_seen_slot,
    t.program as first_program,
    MIN(t.price_sol) as first_price_sol,
    MIN(t.price_usd) as first_price_usd,
    MIN(t.market_cap_usd) as first_market_cap_usd,
    t.program as current_program,
    CURRENT_TIMESTAMP as created_at,
    CURRENT_TIMESTAMP as updated_at
FROM trades_unified t
WHERE NOT EXISTS (
    SELECT 1 FROM tokens_unified tok 
    WHERE tok.mint_address = t.mint_address
)
GROUP BY t.mint_address, t.program;

-- Option 2: If you prefer to remove the foreign key constraint temporarily
-- ALTER TABLE trades_unified DROP CONSTRAINT trades_unified_mint_address_fkey;

-- To re-add the constraint later:
-- ALTER TABLE trades_unified 
-- ADD CONSTRAINT trades_unified_mint_address_fkey 
-- FOREIGN KEY (mint_address) REFERENCES tokens_unified(mint_address);

-- Verify no more orphaned trades
SELECT COUNT(*) as remaining_orphaned_trades 
FROM trades_unified t 
WHERE NOT EXISTS (
    SELECT 1 FROM tokens_unified tok 
    WHERE tok.mint_address = t.mint_address
);