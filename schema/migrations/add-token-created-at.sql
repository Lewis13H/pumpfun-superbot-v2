-- Migration: Add token_created_at column to store actual blockchain creation time
-- This is different from first_seen_at which is when our monitor first detected it

-- Add column for actual token creation time from blockchain
ALTER TABLE tokens_unified 
ADD COLUMN IF NOT EXISTS token_created_at TIMESTAMPTZ;

-- Add comment explaining the difference
COMMENT ON COLUMN tokens_unified.token_created_at IS 'Actual token creation time from blockchain (blockTime)';
COMMENT ON COLUMN tokens_unified.first_seen_at IS 'When this monitor first detected the token';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_tokens_unified_token_created_at 
ON tokens_unified(token_created_at DESC) 
WHERE token_created_at IS NOT NULL;

-- Update existing tokens where we have the data in trades
-- This attempts to find the earliest trade for each token
UPDATE tokens_unified t
SET token_created_at = (
    SELECT MIN(created_at) 
    FROM trades_unified tr 
    WHERE tr.mint_address = t.mint_address
)
WHERE token_created_at IS NULL
AND EXISTS (
    SELECT 1 FROM trades_unified tr WHERE tr.mint_address = t.mint_address
);