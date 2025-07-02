-- Update liquidity_events table to match the expected schema from the handler
-- The handler expects columns for pricing and different naming conventions

-- Add missing columns
ALTER TABLE liquidity_events 
ADD COLUMN IF NOT EXISTS lp_amount BIGINT,
ADD COLUMN IF NOT EXISTS base_amount BIGINT,
ADD COLUMN IF NOT EXISTS quote_amount BIGINT,
ADD COLUMN IF NOT EXISTS base_price_usd DECIMAL(20, 4),
ADD COLUMN IF NOT EXISTS quote_price_usd DECIMAL(20, 4),
ADD COLUMN IF NOT EXISTS total_value_usd DECIMAL(20, 4),
ADD COLUMN IF NOT EXISTS impermanent_loss DECIMAL(10, 4);

-- Update event_type constraint to use 'deposit' and 'withdraw' instead of 'add' and 'remove'
ALTER TABLE liquidity_events DROP CONSTRAINT IF EXISTS liquidity_events_event_type_check;
ALTER TABLE liquidity_events ADD CONSTRAINT liquidity_events_event_type_check 
CHECK (event_type IN ('deposit', 'withdraw', 'add', 'remove'));

-- Create indexes for new columns if they don't exist
CREATE INDEX IF NOT EXISTS idx_liquidity_events_value ON liquidity_events(total_value_usd DESC);