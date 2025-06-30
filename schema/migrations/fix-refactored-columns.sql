-- Fix column name mismatches for refactored system

-- 1. Add missing columns to tokens_unified if they don't exist
DO $$
BEGIN
    -- Add last_price_update if missing (maps to last_update in actual table)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tokens_unified' 
        AND column_name = 'last_price_update'
    ) THEN
        -- Check if last_update exists instead
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'tokens_unified' 
            AND column_name = 'last_update'
        ) THEN
            -- Rename last_update to last_price_update
            ALTER TABLE tokens_unified RENAME COLUMN last_update TO last_price_update;
        ELSE
            -- Add the column
            ALTER TABLE tokens_unified ADD COLUMN last_price_update TIMESTAMP;
        END IF;
    END IF;
END $$;

-- 2. Add volume_usd to trades_unified if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'trades_unified' 
        AND column_name = 'volume_usd'
    ) THEN
        ALTER TABLE trades_unified ADD COLUMN volume_usd DECIMAL(20, 4);
        
        -- Populate existing rows with calculated volume
        UPDATE trades_unified 
        SET volume_usd = (sol_amount::numeric / 1e9) * price_usd
        WHERE volume_usd IS NULL;
    END IF;
END $$;

-- 3. Ensure all required columns exist in tokens_unified
DO $$
BEGIN
    -- Add latest_price_sol if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tokens_unified' 
        AND column_name = 'latest_price_sol'
    ) THEN
        ALTER TABLE tokens_unified ADD COLUMN latest_price_sol DECIMAL(20, 12);
    END IF;
    
    -- Add latest_price_usd if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tokens_unified' 
        AND column_name = 'latest_price_usd'
    ) THEN
        ALTER TABLE tokens_unified ADD COLUMN latest_price_usd DECIMAL(20, 4);
    END IF;
    
    -- Add latest_market_cap_usd if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tokens_unified' 
        AND column_name = 'latest_market_cap_usd'
    ) THEN
        ALTER TABLE tokens_unified ADD COLUMN latest_market_cap_usd DECIMAL(20, 4);
    END IF;
END $$;

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tokens_last_price_update ON tokens_unified(last_price_update);
CREATE INDEX IF NOT EXISTS idx_trades_volume_usd ON trades_unified(volume_usd);

-- Show final table structure
\d tokens_unified
\d trades_unified