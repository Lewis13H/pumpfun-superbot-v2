-- Add columns for tracking latest prices
ALTER TABLE tokens 
ADD COLUMN IF NOT EXISTS last_price_usd NUMERIC,
ADD COLUMN IF NOT EXISTS last_updated TIMESTAMP;

-- Add column to distinguish graduated prices in price_updates
ALTER TABLE price_updates
ADD COLUMN IF NOT EXISTS is_graduated BOOLEAN DEFAULT FALSE;

-- Create index for faster graduated token queries
CREATE INDEX IF NOT EXISTS idx_price_updates_graduated ON price_updates(token, is_graduated, time DESC);