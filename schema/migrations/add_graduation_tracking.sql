-- Add graduation fields to tokens table
ALTER TABLE tokens 
ADD COLUMN IF NOT EXISTS graduated BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS graduation_time TIMESTAMP,
ADD COLUMN IF NOT EXISTS pool_address TEXT,
ADD COLUMN IF NOT EXISTS graduation_sol_amount NUMERIC;

-- Create graduation events table
CREATE TABLE IF NOT EXISTS graduation_events (
  id SERIAL PRIMARY KEY,
  mint TEXT UNIQUE NOT NULL,
  user_address TEXT NOT NULL,
  pool_address TEXT NOT NULL,
  sol_amount NUMERIC NOT NULL,
  mint_amount TEXT NOT NULL,
  pool_migration_fee NUMERIC,
  bonding_curve TEXT,
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_graduation_events_mint ON graduation_events(mint);
CREATE INDEX IF NOT EXISTS idx_tokens_graduated ON tokens(graduated);

-- Update any tokens that might have graduated based on progress
-- (This is a rough estimate - actual graduations should be tracked via events)
UPDATE tokens 
SET graduated = true 
WHERE address IN (
  SELECT DISTINCT token 
  FROM price_updates 
  WHERE progress >= 85
);