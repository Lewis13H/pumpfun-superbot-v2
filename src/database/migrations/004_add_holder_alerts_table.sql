-- Migration: 004_add_holder_alerts_table.sql
-- Author: Claude
-- Date: 2025-01-09
-- Description: Adds holder_alerts table for Session 8 historical tracking and alerts

-- =====================================================
-- Migration Script Start
-- =====================================================

-- Create holder alerts table
CREATE TABLE IF NOT EXISTS holder_alerts (
  id SERIAL PRIMARY KEY,
  mint_address VARCHAR(44) NOT NULL,
  alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('score_drop', 'concentration_increase', 'rapid_growth', 'high_churn', 'bot_activity')),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  triggered_at TIMESTAMP DEFAULT NOW(),
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add foreign key constraint if tokens_unified exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tokens_unified') THEN
    ALTER TABLE holder_alerts
    ADD CONSTRAINT fk_holder_alerts_mint_address
    FOREIGN KEY (mint_address) REFERENCES tokens_unified(mint_address)
    ON DELETE CASCADE;
  END IF;
END $$;

-- Create indexes for holder alerts
CREATE INDEX IF NOT EXISTS idx_holder_alerts_mint ON holder_alerts(mint_address);
CREATE INDEX IF NOT EXISTS idx_holder_alerts_type ON holder_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_holder_alerts_severity ON holder_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_holder_alerts_triggered ON holder_alerts(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_holder_alerts_acknowledged ON holder_alerts(acknowledged) WHERE acknowledged = false;

-- Insert into migration history if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migration_history') THEN
    INSERT INTO migration_history (migration_name, applied_at)
    VALUES ('004_add_holder_alerts_table.sql', CURRENT_TIMESTAMP)
    ON CONFLICT (migration_name) DO NOTHING;
  END IF;
END $$;

-- =====================================================
-- Migration Complete
-- =====================================================