-- Migration: 003_add_holder_analysis_tables.sql
-- Author: Claude
-- Date: 2025-01-07
-- Description: Adds tables for token holder analysis system including snapshots, wallet classifications, and detailed holder information

-- =====================================================
-- Migration Script Start
-- =====================================================

-- Create holder snapshots table for historical tracking
CREATE TABLE IF NOT EXISTS holder_snapshots (
  id SERIAL PRIMARY KEY,
  mint_address VARCHAR(44) NOT NULL,
  snapshot_time TIMESTAMP DEFAULT NOW(),
  total_holders INTEGER NOT NULL,
  unique_holders INTEGER NOT NULL,
  top_10_percentage DECIMAL(5,2),
  top_25_percentage DECIMAL(5,2),
  top_100_percentage DECIMAL(5,2),
  gini_coefficient DECIMAL(5,4),
  herfindahl_index DECIMAL(5,4),
  holder_score INTEGER CHECK (holder_score >= 0 AND holder_score <= 300),
  score_breakdown JSONB,
  raw_data_hash VARCHAR(64), -- For change detection
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(mint_address, snapshot_time)
);

-- Add foreign key constraint if tokens_unified exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tokens_unified') THEN
    ALTER TABLE holder_snapshots
    ADD CONSTRAINT fk_holder_snapshots_mint_address
    FOREIGN KEY (mint_address) REFERENCES tokens_unified(mint_address)
    ON DELETE CASCADE;
  END IF;
END $$;

-- Create indexes for holder snapshots
CREATE INDEX IF NOT EXISTS idx_holder_snapshots_mint_time ON holder_snapshots(mint_address, snapshot_time DESC);
CREATE INDEX IF NOT EXISTS idx_holder_snapshots_score ON holder_snapshots(holder_score);
CREATE INDEX IF NOT EXISTS idx_holder_snapshots_created ON holder_snapshots(created_at DESC);

-- Create wallet classifications table
CREATE TABLE IF NOT EXISTS wallet_classifications (
  wallet_address VARCHAR(44) PRIMARY KEY,
  classification VARCHAR(50) NOT NULL CHECK (classification IN ('sniper', 'bot', 'bundler', 'developer', 'whale', 'normal', 'unknown')),
  sub_classification VARCHAR(50), -- e.g., 'jito_bundler', 'mev_bot'
  confidence_score DECIMAL(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  detection_metadata JSONB,
  first_seen TIMESTAMP DEFAULT NOW(),
  last_activity TIMESTAMP,
  total_tokens_traded INTEGER DEFAULT 0,
  suspicious_activity_count INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for wallet classifications
CREATE INDEX IF NOT EXISTS idx_wallet_classifications_type ON wallet_classifications(classification);
CREATE INDEX IF NOT EXISTS idx_wallet_classifications_activity ON wallet_classifications(last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_classifications_suspicious ON wallet_classifications(suspicious_activity_count) WHERE suspicious_activity_count > 0;

-- Create detailed token holder information table
CREATE TABLE IF NOT EXISTS token_holder_details (
  id SERIAL PRIMARY KEY,
  mint_address VARCHAR(44) NOT NULL,
  wallet_address VARCHAR(44) NOT NULL,
  balance DECIMAL(30,0) NOT NULL,
  percentage_held DECIMAL(8,5),
  rank INTEGER,
  first_acquired TIMESTAMP,
  last_transaction TIMESTAMP,
  transaction_count INTEGER DEFAULT 1,
  realized_profit_sol DECIMAL(20,9),
  unrealized_profit_sol DECIMAL(20,9),
  is_locked BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(mint_address, wallet_address)
);

-- Add foreign key constraints if tables exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tokens_unified') THEN
    ALTER TABLE token_holder_details
    ADD CONSTRAINT fk_token_holder_details_mint_address
    FOREIGN KEY (mint_address) REFERENCES tokens_unified(mint_address)
    ON DELETE CASCADE;
  END IF;
  
  ALTER TABLE token_holder_details
  ADD CONSTRAINT fk_token_holder_details_wallet_address
  FOREIGN KEY (wallet_address) REFERENCES wallet_classifications(wallet_address)
  ON DELETE CASCADE;
END $$;

-- Create indexes for token holder details
CREATE INDEX IF NOT EXISTS idx_token_holder_details_mint ON token_holder_details(mint_address);
CREATE INDEX IF NOT EXISTS idx_token_holder_details_wallet ON token_holder_details(wallet_address);
CREATE INDEX IF NOT EXISTS idx_token_holder_details_balance ON token_holder_details(mint_address, balance DESC);
CREATE INDEX IF NOT EXISTS idx_token_holder_details_percentage ON token_holder_details(mint_address, percentage_held DESC);
CREATE INDEX IF NOT EXISTS idx_token_holder_details_updated ON token_holder_details(updated_at DESC);

-- Create holder analysis metadata table for tracking analysis runs
CREATE TABLE IF NOT EXISTS holder_analysis_metadata (
  id SERIAL PRIMARY KEY,
  mint_address VARCHAR(44) NOT NULL,
  analysis_type VARCHAR(50) NOT NULL, -- 'initial', 'scheduled', 'manual'
  status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  holders_analyzed INTEGER,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add foreign key constraint if tokens_unified exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tokens_unified') THEN
    ALTER TABLE holder_analysis_metadata
    ADD CONSTRAINT fk_holder_analysis_metadata_mint_address
    FOREIGN KEY (mint_address) REFERENCES tokens_unified(mint_address)
    ON DELETE CASCADE;
  END IF;
END $$;

-- Create indexes for holder analysis metadata
CREATE INDEX IF NOT EXISTS idx_holder_analysis_metadata_mint ON holder_analysis_metadata(mint_address);
CREATE INDEX IF NOT EXISTS idx_holder_analysis_metadata_status ON holder_analysis_metadata(status);
CREATE INDEX IF NOT EXISTS idx_holder_analysis_metadata_created ON holder_analysis_metadata(created_at DESC);

-- Create holder trend tracking table
CREATE TABLE IF NOT EXISTS holder_trends (
  id SERIAL PRIMARY KEY,
  mint_address VARCHAR(44) NOT NULL,
  time_window VARCHAR(20) NOT NULL CHECK (time_window IN ('1h', '6h', '24h', '7d', '30d')),
  holder_count_change INTEGER,
  holder_growth_rate DECIMAL(8,4),
  avg_holder_duration_hours DECIMAL(10,2),
  churn_rate DECIMAL(5,2),
  new_whale_count INTEGER DEFAULT 0,
  new_sniper_count INTEGER DEFAULT 0,
  calculated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(mint_address, time_window, calculated_at)
);

-- Add foreign key constraint if tokens_unified exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tokens_unified') THEN
    ALTER TABLE holder_trends
    ADD CONSTRAINT fk_holder_trends_mint_address
    FOREIGN KEY (mint_address) REFERENCES tokens_unified(mint_address)
    ON DELETE CASCADE;
  END IF;
END $$;

-- Create indexes for holder trends
CREATE INDEX IF NOT EXISTS idx_holder_trends_mint_window ON holder_trends(mint_address, time_window);
CREATE INDEX IF NOT EXISTS idx_holder_trends_calculated ON holder_trends(calculated_at DESC);

-- Create function to update wallet classification activity
CREATE OR REPLACE FUNCTION update_wallet_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE wallet_classifications
  SET 
    last_activity = NOW(),
    total_tokens_traded = total_tokens_traded + 1,
    updated_at = NOW()
  WHERE wallet_address = NEW.wallet_address;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for wallet activity updates
DROP TRIGGER IF EXISTS trg_update_wallet_activity ON token_holder_details;
CREATE TRIGGER trg_update_wallet_activity
  AFTER INSERT OR UPDATE ON token_holder_details
  FOR EACH ROW
  EXECUTE FUNCTION update_wallet_activity();

-- Insert into migration history if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migration_history') THEN
    INSERT INTO migration_history (migration_name, applied_at)
    VALUES ('003_add_holder_analysis_tables.sql', CURRENT_TIMESTAMP)
    ON CONFLICT (migration_name) DO NOTHING;
  END IF;
END $$;

-- =====================================================
-- Migration Complete
-- =====================================================