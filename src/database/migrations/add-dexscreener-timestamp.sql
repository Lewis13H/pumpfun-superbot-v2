-- Add DexScreener update timestamp to tokens_unified
ALTER TABLE tokens_unified 
ADD COLUMN IF NOT EXISTS last_dexscreener_update TIMESTAMP;

-- Add index for finding stale graduated tokens
CREATE INDEX IF NOT EXISTS idx_tokens_graduated_stale 
ON tokens_unified(graduated_to_amm, updated_at) 
WHERE graduated_to_amm = TRUE;