-- Migration: Add recovery progress tracking table
-- Purpose: Track historical data recovery operations and their progress

-- Create recovery progress table
CREATE TABLE IF NOT EXISTS recovery_progress (
  id SERIAL PRIMARY KEY,
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  tokens_processed INTEGER DEFAULT 0,
  tokens_total INTEGER DEFAULT 0,
  trades_recovered INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error_message TEXT,
  recovery_source VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_recovery_progress_status ON recovery_progress(status);
CREATE INDEX IF NOT EXISTS idx_recovery_progress_period ON recovery_progress(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_recovery_progress_created ON recovery_progress(created_at DESC);

-- Create a view for recovery statistics
CREATE OR REPLACE VIEW recovery_statistics AS
SELECT 
  COUNT(*) as total_recoveries,
  COUNT(*) FILTER (WHERE status = 'completed') as successful_recoveries,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_recoveries,
  COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_recoveries,
  SUM(trades_recovered) as total_trades_recovered,
  SUM(tokens_processed) as total_tokens_processed,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_recovery_time_seconds,
  MAX(completed_at) as last_recovery_completed
FROM recovery_progress
WHERE started_at IS NOT NULL;

-- Create a table to track detected downtime periods
CREATE TABLE IF NOT EXISTS downtime_periods (
  id SERIAL PRIMARY KEY,
  gap_start_slot BIGINT NOT NULL,
  gap_end_slot BIGINT NOT NULL,
  gap_start_time TIMESTAMP NOT NULL,
  gap_end_time TIMESTAMP NOT NULL,
  gap_duration_seconds INTEGER NOT NULL,
  affected_programs TEXT[],
  estimated_missed_trades INTEGER,
  detected_at TIMESTAMP DEFAULT NOW(),
  recovery_attempted BOOLEAN DEFAULT FALSE,
  recovery_progress_id INTEGER REFERENCES recovery_progress(id),
  UNIQUE(gap_start_slot, gap_end_slot)
);

-- Create indexes for downtime periods
CREATE INDEX IF NOT EXISTS idx_downtime_periods_time ON downtime_periods(gap_start_time, gap_end_time);
CREATE INDEX IF NOT EXISTS idx_downtime_periods_duration ON downtime_periods(gap_duration_seconds) WHERE gap_duration_seconds > 300;
CREATE INDEX IF NOT EXISTS idx_downtime_periods_recovery ON downtime_periods(recovery_attempted);

-- Function to get recent downtime summary
CREATE OR REPLACE FUNCTION get_downtime_summary(
  p_hours INTEGER DEFAULT 24
) RETURNS TABLE (
  total_gaps INTEGER,
  total_downtime_minutes INTEGER,
  avg_gap_minutes DECIMAL,
  max_gap_minutes INTEGER,
  estimated_total_missed_trades INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::INTEGER as total_gaps,
    (SUM(gap_duration_seconds) / 60)::INTEGER as total_downtime_minutes,
    ROUND(AVG(gap_duration_seconds / 60.0), 2) as avg_gap_minutes,
    (MAX(gap_duration_seconds) / 60)::INTEGER as max_gap_minutes,
    COALESCE(SUM(estimated_missed_trades), 0)::INTEGER as estimated_total_missed_trades
  FROM downtime_periods
  WHERE gap_start_time > NOW() - INTERVAL '1 hour' * p_hours;
END;
$$ LANGUAGE plpgsql;

-- Add recovery audit log for detailed tracking
CREATE TABLE IF NOT EXISTS recovery_audit_log (
  id SERIAL PRIMARY KEY,
  recovery_progress_id INTEGER REFERENCES recovery_progress(id),
  action VARCHAR(50) NOT NULL,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recovery_audit_log_progress ON recovery_audit_log(recovery_progress_id);
CREATE INDEX IF NOT EXISTS idx_recovery_audit_log_created ON recovery_audit_log(created_at DESC);

-- Add comments for documentation
COMMENT ON TABLE recovery_progress IS 'Tracks historical data recovery operations and their progress';
COMMENT ON TABLE downtime_periods IS 'Stores detected downtime periods for monitoring and recovery';
COMMENT ON TABLE recovery_audit_log IS 'Detailed audit log of recovery operations';
COMMENT ON COLUMN recovery_progress.recovery_source IS 'Source used for recovery: graphql, dexscreener, rpc, etc.';
COMMENT ON COLUMN downtime_periods.affected_programs IS 'Array of program IDs affected during the downtime';