-- Add bonding_curve_key column to trades_unified table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'trades_unified' 
        AND column_name = 'bonding_curve_key'
    ) THEN
        ALTER TABLE trades_unified 
        ADD COLUMN bonding_curve_key VARCHAR(64);
        
        -- Create index on bonding_curve_key for faster lookups
        CREATE INDEX idx_trades_unified_bonding_curve_key 
        ON trades_unified(bonding_curve_key) 
        WHERE bonding_curve_key IS NOT NULL;
    END IF;
END $$;

-- Create bonding_curve_mappings table if it doesn't exist
CREATE TABLE IF NOT EXISTS bonding_curve_mappings (
    bonding_curve_key VARCHAR(64) PRIMARY KEY,
    mint_address VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(mint_address)
);

-- Create index on mint_address for reverse lookups
CREATE INDEX IF NOT EXISTS idx_bc_mappings_mint ON bonding_curve_mappings(mint_address);