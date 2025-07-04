-- Immediate fix for foreign key constraint issues
-- Run this to allow the system to start processing trades immediately

-- Step 1: Drop the foreign key constraint that's causing issues
ALTER TABLE trades_unified DROP CONSTRAINT IF EXISTS trades_unified_mint_address_fkey;

-- Step 2: Create a trigger to automatically create tokens when trades reference new ones
CREATE OR REPLACE FUNCTION create_token_if_not_exists()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if token exists
    IF NOT EXISTS (SELECT 1 FROM tokens_unified WHERE mint_address = NEW.mint_address) THEN
        -- Create a placeholder token entry
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
        ) VALUES (
            NEW.mint_address,
            'UNKNOWN',
            'Unknown Token',
            COALESCE(NEW.block_time, NEW.created_at, CURRENT_TIMESTAMP),
            NEW.slot,
            NEW.program,
            NEW.price_sol,
            NEW.price_usd,
            NEW.market_cap_usd,
            NEW.program,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (mint_address) DO NOTHING;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Create trigger on trades_unified
DROP TRIGGER IF EXISTS ensure_token_exists ON trades_unified;
CREATE TRIGGER ensure_token_exists
    BEFORE INSERT ON trades_unified
    FOR EACH ROW
    EXECUTE FUNCTION create_token_if_not_exists();

-- Step 4: Create any missing tokens for existing trades
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
    MIN(COALESCE(t.block_time, t.created_at, CURRENT_TIMESTAMP)) as first_seen_at,
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

-- Step 5: Re-add the foreign key constraint (optional - only if you want to maintain referential integrity)
-- ALTER TABLE trades_unified 
-- ADD CONSTRAINT trades_unified_mint_address_fkey 
-- FOREIGN KEY (mint_address) REFERENCES tokens_unified(mint_address);

-- Verify the fix
SELECT 
    (SELECT COUNT(*) FROM trades_unified) as total_trades,
    (SELECT COUNT(DISTINCT mint_address) FROM trades_unified) as unique_tokens_in_trades,
    (SELECT COUNT(*) FROM tokens_unified) as total_tokens,
    (SELECT COUNT(*) FROM trades_unified t WHERE NOT EXISTS (
        SELECT 1 FROM tokens_unified tok WHERE tok.mint_address = t.mint_address
    )) as orphaned_trades;

-- Grant permissions on the function
GRANT EXECUTE ON FUNCTION create_token_if_not_exists() TO pump_user;