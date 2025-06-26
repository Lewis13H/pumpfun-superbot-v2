-- Create sol_prices table to track SOL price over time
CREATE TABLE IF NOT EXISTS sol_prices (
  id SERIAL PRIMARY KEY,
  price NUMERIC NOT NULL,
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Create index for faster timestamp lookups
CREATE INDEX IF NOT EXISTS idx_sol_prices_timestamp ON sol_prices(timestamp DESC);

-- Insert current SOL price as a default (will be updated by the service)
INSERT INTO sol_prices (price) VALUES (143.78);