-- Database Cleanup Script
-- Removes tokens without 'pump' in mint address
-- Removes tokens not saved today

-- Show current state
SELECT 'Before cleanup:' as status;
SELECT COUNT(*) as total_tokens FROM tokens_unified;
SELECT COUNT(*) as tokens_to_keep 
FROM tokens_unified 
WHERE mint_address LIKE '%pump%' 
  AND created_at::date = CURRENT_DATE;

-- First, delete related trades
DELETE FROM trades_unified 
WHERE mint_address IN (
    SELECT mint_address 
    FROM tokens_unified 
    WHERE mint_address NOT LIKE '%pump%' 
       OR created_at::date < CURRENT_DATE
);

-- Then delete the tokens
DELETE FROM tokens_unified 
WHERE mint_address NOT LIKE '%pump%' 
   OR created_at::date < CURRENT_DATE;

-- Show results
SELECT 'After cleanup:' as status;
SELECT COUNT(*) as remaining_tokens FROM tokens_unified;
SELECT 
    COUNT(DISTINCT mint_address) as unique_tokens,
    MIN(created_at) as earliest_token,
    MAX(created_at) as latest_token
FROM tokens_unified;

-- Verify all remaining tokens have 'pump' and are from today
SELECT 
    CASE 
        WHEN COUNT(*) = 0 THEN 'All tokens are valid pump tokens from today!'
        ELSE 'WARNING: Found invalid tokens!'
    END as validation_result
FROM tokens_unified
WHERE mint_address NOT LIKE '%pump%' 
   OR created_at::date < CURRENT_DATE;