/**
 * API Endpoints for Stale Token Monitoring
 * Provides statistics and management for stale token detection
 */

import { Router } from 'express';
import { Pool } from 'pg';
import { EnhancedStaleTokenDetector } from '../services/token-management/enhanced-stale-token-detector';

export function createStaleTokenEndpoints(pool: Pool): Router {
  const router = Router();
  const detector = EnhancedStaleTokenDetector.getInstance();
  
  /**
   * Get stale token statistics
   */
  router.get('/stats', async (_req, res) => {
    try {
      const stats = detector.getEnhancedStats();
      
      // Get database statistics
      const dbStats = await pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE is_stale = true) as stale_tokens,
          COUNT(*) FILTER (WHERE should_remove = true) as removal_candidates,
          COUNT(*) FILTER (WHERE is_stale = true AND latest_market_cap_usd > 50000) as critical_stale,
          COUNT(*) FILTER (WHERE is_stale = true AND latest_market_cap_usd BETWEEN 20000 AND 50000) as high_stale,
          COUNT(*) FILTER (WHERE is_stale = true AND latest_market_cap_usd BETWEEN 10000 AND 20000) as medium_stale,
          COUNT(*) FILTER (WHERE is_stale = true AND latest_market_cap_usd BETWEEN 5000 AND 10000) as low_stale,
          COUNT(*) FILTER (WHERE is_stale = true AND latest_market_cap_usd < 5000) as micro_stale,
          AVG(EXTRACT(EPOCH FROM (NOW() - last_trade_at)) / 60) FILTER (WHERE is_stale = true) as avg_stale_minutes
        FROM tokens_unified
      `);
      
      res.json({
        detector: stats,
        database: dbStats.rows[0],
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error fetching stale token stats:', error);
      res.status(500).json({ error: 'Failed to fetch statistics' });
    }
  });
  
  /**
   * Get list of stale tokens
   */
  router.get('/tokens', async (req, res) => {
    try {
      const { 
        tier = 'all', 
        limit = '50', 
        offset = '0',
        sort = 'market_cap_desc' 
      } = req.query;
      
      let tierFilter = '';
      if (tier !== 'all') {
        const tierThresholds: Record<string, string> = {
          critical: 'latest_market_cap_usd >= 50000',
          high: 'latest_market_cap_usd BETWEEN 20000 AND 50000',
          medium: 'latest_market_cap_usd BETWEEN 10000 AND 20000',
          low: 'latest_market_cap_usd BETWEEN 5000 AND 10000',
          micro: 'latest_market_cap_usd < 5000'
        };
        tierFilter = tierThresholds[tier as string] ? `AND ${tierThresholds[tier as string]}` : '';
      }
      
      const sortOptions: Record<string, string> = {
        market_cap_desc: 'latest_market_cap_usd DESC',
        market_cap_asc: 'latest_market_cap_usd ASC',
        stale_time_desc: 'minutes_since_trade DESC',
        stale_time_asc: 'minutes_since_trade ASC'
      };
      const orderBy = sortOptions[sort as string] || 'latest_market_cap_usd DESC';
      
      const result = await pool.query(`
        SELECT 
          mint_address,
          symbol,
          name,
          latest_price_usd,
          latest_market_cap_usd,
          last_trade_at,
          is_stale,
          should_remove,
          graduated_to_amm,
          EXTRACT(EPOCH FROM (NOW() - last_trade_at)) / 60 as minutes_since_trade,
          CASE 
            WHEN latest_market_cap_usd >= 50000 THEN 'critical'
            WHEN latest_market_cap_usd >= 20000 THEN 'high'
            WHEN latest_market_cap_usd >= 10000 THEN 'medium'
            WHEN latest_market_cap_usd >= 5000 THEN 'low'
            ELSE 'micro'
          END as tier
        FROM tokens_unified
        WHERE is_stale = true ${tierFilter}
        ORDER BY ${orderBy}
        LIMIT $1 OFFSET $2
      `, [limit, offset]);
      
      // Get total count
      const countResult = await pool.query(`
        SELECT COUNT(*) as total
        FROM tokens_unified
        WHERE is_stale = true ${tierFilter}
      `);
      
      res.json({
        tokens: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      });
    } catch (error) {
      console.error('Error fetching stale tokens:', error);
      res.status(500).json({ error: 'Failed to fetch stale tokens' });
    }
  });
  
  /**
   * Get detection run history
   */
  router.get('/runs', async (req, res) => {
    try {
      const { limit = '20' } = req.query;
      
      const result = await pool.query(`
        SELECT 
          id,
          run_at,
          tokens_checked,
          tokens_marked_stale,
          tokens_marked_removal,
          tokens_recovered,
          execution_time_ms,
          status,
          error_message
        FROM stale_detection_runs
        ORDER BY run_at DESC
        LIMIT $1
      `, [limit]);
      
      res.json({
        runs: result.rows,
        total: result.rows.length
      });
    } catch (error) {
      console.error('Error fetching detection runs:', error);
      res.status(500).json({ error: 'Failed to fetch detection runs' });
    }
  });
  
  /**
   * Manually trigger recovery for specific tokens
   */
  router.post('/recover', async (req, res) => {
    try {
      const { mintAddresses } = req.body;
      
      if (!Array.isArray(mintAddresses) || mintAddresses.length === 0) {
        res.status(400).json({ error: 'mintAddresses array required' });
        return;
      }
      
      if (mintAddresses.length > 100) {
        res.status(400).json({ error: 'Maximum 100 tokens per request' });
        return;
      }
      
      // Verify tokens exist
      const verification = await pool.query(`
        SELECT mint_address 
        FROM tokens_unified 
        WHERE mint_address = ANY($1::varchar[])
      `, [mintAddresses]);
      
      const validMints = verification.rows.map(r => r.mint_address);
      if (validMints.length === 0) {
        res.status(404).json({ error: 'No valid tokens found' });
        return;
      }
      
      // Mark tokens for recovery
      const results: any[] = [];
      for (const mint of validMints) {
        try {
          await pool.query(`
            UPDATE tokens_unified 
            SET is_stale = true 
            WHERE mint_address = $1
          `, [mint]);
          results.push({ mintAddress: mint, success: true, message: 'Queued for recovery' });
        } catch (error) {
          results.push({ mintAddress: mint, success: false, error: 'Failed to queue' });
        }
      }
      
      res.json({
        requested: mintAddresses.length,
        valid: validMints.length,
        results: results
      });
    } catch (error) {
      console.error('Error recovering tokens:', error);
      res.status(500).json({ error: 'Failed to recover tokens' });
    }
  });
  
  /**
   * Mark token as not stale (false positive recovery)
   */
  router.post('/mark-fresh', async (req, res) => {
    try {
      const { mintAddress, reason } = req.body;
      
      if (!mintAddress) {
        res.status(400).json({ error: 'mintAddress required' });
        return;
      }
      
      // Get current token state
      const currentState = await pool.query(`
        SELECT 
          mint_address, 
          symbol, 
          name,
          is_stale,
          should_remove,
          latest_market_cap_usd,
          last_trade_at
        FROM tokens_unified
        WHERE mint_address = $1
      `, [mintAddress]);
      
      if (currentState.rows.length === 0) {
        res.status(404).json({ error: 'Token not found' });
        return;
      }
      
      const token = currentState.rows[0];
      
      // Update token state
      const result = await pool.query(`
        UPDATE tokens_unified
        SET 
          is_stale = false,
          should_remove = false,
          last_trade_at = NOW(),
          updated_at = NOW()
        WHERE mint_address = $1
        RETURNING mint_address, symbol, name, latest_market_cap_usd
      `, [mintAddress]);
      
      // Log the recovery
      await pool.query(`
        INSERT INTO stale_token_recovery (
          recovery_batch_id,
          tokens_checked,
          tokens_recovered,
          status,
          created_at
        ) VALUES ($1, 1, 1, 'manual_recovery', NOW())
      `, [`manual_${Date.now()}`]);
      
      res.json({
        success: true,
        token: result.rows[0],
        previousState: {
          wasStale: token.is_stale,
          wasMarkedForRemoval: token.should_remove
        },
        reason: reason || 'Manual false positive correction'
      });
    } catch (error) {
      console.error('Error marking token as fresh:', error);
      res.status(500).json({ error: 'Failed to update token' });
    }
  });
  
  /**
   * Restore removed token
   */
  router.post('/restore', async (req, res) => {
    try {
      const { mintAddress } = req.body;
      
      if (!mintAddress) {
        res.status(400).json({ error: 'mintAddress required' });
        return;
      }
      
      // Check if token was soft deleted (threshold_crossed_at set to NULL)
      const checkToken = await pool.query(`
        SELECT 
          mint_address,
          symbol,
          name,
          first_market_cap_usd,
          threshold_crossed_at
        FROM tokens_unified
        WHERE mint_address = $1
      `, [mintAddress]);
      
      if (checkToken.rows.length === 0) {
        res.status(404).json({ error: 'Token not found (may have been hard deleted)' });
        return;
      }
      
      const token = checkToken.rows[0];
      
      // Restore token to active monitoring
      const result = await pool.query(`
        UPDATE tokens_unified
        SET 
          is_stale = false,
          should_remove = false,
          threshold_crossed_at = CASE 
            WHEN threshold_crossed_at IS NULL AND first_market_cap_usd >= 8888 
            THEN NOW() 
            ELSE threshold_crossed_at 
          END,
          last_trade_at = NOW(),
          updated_at = NOW()
        WHERE mint_address = $1
        RETURNING *
      `, [mintAddress]);
      
      res.json({
        success: true,
        token: result.rows[0],
        restored: {
          thresholdRestored: token.threshold_crossed_at === null && result.rows[0].threshold_crossed_at !== null
        }
      });
    } catch (error) {
      console.error('Error restoring token:', error);
      res.status(500).json({ error: 'Failed to restore token' });
    }
  });
  
  /**
   * Get tier configuration
   */
  router.get('/tiers', async (_req, res) => {
    try {
      // Get configured tiers
      const config = {
        tiers: [
          { name: 'critical', thresholdUsd: 50000, staleMinutes: 15, removeMinutes: 60 },
          { name: 'high', thresholdUsd: 20000, staleMinutes: 30, removeMinutes: 120 },
          { name: 'medium', thresholdUsd: 10000, staleMinutes: 45, removeMinutes: 180 },
          { name: 'low', thresholdUsd: 5000, staleMinutes: 60, removeMinutes: 240 },
          { name: 'micro', thresholdUsd: 0, staleMinutes: 120, removeMinutes: 360 }
        ]
      };
      
      // Get token counts per tier
      const tierCounts = await pool.query(`
        SELECT 
          CASE 
            WHEN latest_market_cap_usd >= 50000 THEN 'critical'
            WHEN latest_market_cap_usd >= 20000 THEN 'high'
            WHEN latest_market_cap_usd >= 10000 THEN 'medium'
            WHEN latest_market_cap_usd >= 5000 THEN 'low'
            ELSE 'micro'
          END as tier,
          COUNT(*) as total_tokens,
          COUNT(*) FILTER (WHERE is_stale = true) as stale_tokens,
          COUNT(*) FILTER (WHERE should_remove = true) as removal_candidates
        FROM tokens_unified
        WHERE latest_market_cap_usd > 1000
        GROUP BY tier
      `);
      
      // Merge counts with configuration
      const tiersWithCounts = config.tiers.map(tier => {
        const counts = tierCounts.rows.find(r => r.tier === tier.name) || {
          total_tokens: 0,
          stale_tokens: 0,
          removal_candidates: 0
        };
        return {
          ...tier,
          ...counts
        };
      });
      
      res.json({
        tiers: tiersWithCounts,
        autoRemovalEnabled: true,
        scanIntervalMinutes: 5
      });
    } catch (error) {
      console.error('Error fetching tier configuration:', error);
      res.status(500).json({ error: 'Failed to fetch tier configuration' });
    }
  });
  
  return router;
}