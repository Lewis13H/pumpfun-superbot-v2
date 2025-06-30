-- Fix missing columns for refactored system

-- Add missing columns to tokens_unified table
ALTER TABLE tokens_unified 
ADD COLUMN IF NOT EXISTS current_price_sol DECIMAL(20, 12),
ADD COLUMN IF NOT EXISTS current_price_usd DECIMAL(20, 4),
ADD COLUMN IF NOT EXISTS last_price_update TIMESTAMP,
ADD COLUMN IF NOT EXISTS first_seen_slot BIGINT;

-- Update existing rows to have first_seen_slot if null
UPDATE tokens_unified 
SET first_seen_slot = 0 
WHERE first_seen_slot IS NULL;

-- Make first_seen_slot NOT NULL after populating
ALTER TABLE tokens_unified 
ALTER COLUMN first_seen_slot SET NOT NULL;

-- Fix bonding_curve_mappings unique constraint to use ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS idx_bc_mappings_bc_key_unique 
ON bonding_curve_mappings(bonding_curve_key);

-- Add ON CONFLICT handling for bonding_curve_mappings inserts
-- This needs to be handled in the application code

-- Add volume_usd column to trades_unified if missing (from previous cleanup)
ALTER TABLE trades_unified
ADD COLUMN IF NOT EXISTS volume_usd DECIMAL(20, 4);

-- Update volume_usd for existing records
UPDATE trades_unified
SET volume_usd = (sol_amount::numeric / 1e9) * price_usd
WHERE volume_usd IS NULL;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_tokens_last_price_update 
ON tokens_unified(last_price_update) 
WHERE last_price_update IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tokens_first_seen_slot 
ON tokens_unified(first_seen_slot);
EOF < /dev/null