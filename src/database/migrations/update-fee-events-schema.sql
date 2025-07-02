-- Update amm_fee_events table to match the expected schema from the service

-- Add missing columns
ALTER TABLE amm_fee_events 
ADD COLUMN IF NOT EXISTS signature VARCHAR(88),
ADD COLUMN IF NOT EXISTS event_type VARCHAR(30),
ADD COLUMN IF NOT EXISTS recipient VARCHAR(64),
ADD COLUMN IF NOT EXISTS coin_amount BIGINT,
ADD COLUMN IF NOT EXISTS pc_amount BIGINT,
ADD COLUMN IF NOT EXISTS coin_value_usd DECIMAL(20, 4),
ADD COLUMN IF NOT EXISTS pc_value_usd DECIMAL(20, 4),
ADD COLUMN IF NOT EXISTS total_value_usd DECIMAL(20, 4);

-- Create unique constraint for signature and event_type
ALTER TABLE amm_fee_events DROP CONSTRAINT IF EXISTS amm_fee_events_signature_event_type_key;
ALTER TABLE amm_fee_events ADD CONSTRAINT amm_fee_events_signature_event_type_key UNIQUE (signature, event_type);

-- Add index for signature if not exists
CREATE INDEX IF NOT EXISTS idx_fee_events_signature_new ON amm_fee_events(signature);