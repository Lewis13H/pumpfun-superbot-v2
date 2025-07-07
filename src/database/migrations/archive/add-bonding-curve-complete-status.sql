-- Migration: Add bonding curve complete status and accurate progress tracking
-- Date: 2025-01-07
-- Purpose: Store both progress (0-100%) and complete boolean from bonding curve accounts

-- Add bonding_curve_complete column to tokens_unified
ALTER TABLE tokens_unified 
ADD COLUMN IF NOT EXISTS bonding_curve_complete BOOLEAN DEFAULT FALSE;

-- Add index for finding non-graduated tokens with complete flag
CREATE INDEX IF NOT EXISTS idx_tokens_bc_complete 
ON tokens_unified(bonding_curve_complete) 
WHERE bonding_curve_complete = true AND graduated_to_amm = false;

-- Add comment to explain the columns
COMMENT ON COLUMN tokens_unified.latest_bonding_curve_progress IS 'Progress percentage (0-100) based on SOL in bonding curve';
COMMENT ON COLUMN tokens_unified.bonding_curve_complete IS 'Complete flag from bonding curve account - definitive graduation status';

-- Update existing graduated tokens to have complete = true
UPDATE tokens_unified 
SET bonding_curve_complete = true 
WHERE graduated_to_amm = true 
  AND bonding_curve_complete = false;