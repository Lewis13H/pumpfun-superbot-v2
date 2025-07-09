import { Request, Response } from 'express';
import { Pool } from 'pg';
import { logger } from '../core/logger';
import { HolderAnalysisService } from '../services/holder-analysis/holder-analysis-service';
import { HolderComparisonService } from '../services/holder-analysis/historical/comparison-service';
import { HolderReportGenerator } from '../services/holder-analysis/reports/holder-report-generator';

export class HolderAnalysisHistoricalController {
  private analysisService: HolderAnalysisService;
  private comparisonService: HolderComparisonService;
  private reportGenerator: HolderReportGenerator;

  constructor(pool: Pool) {
    this.analysisService = new HolderAnalysisService(
      pool,
      process.env.HELIUS_API_KEY,
      process.env.SHYFT_API_KEY
    );
    this.comparisonService = new HolderComparisonService(pool);
    this.reportGenerator = new HolderReportGenerator(pool);
  }

  /**
   * GET /api/v1/holder-analysis/:mintAddress/history
   * Get historical holder data with trends
   */
  async getHolderHistory(req: Request, res: Response): Promise<void> {
    try {
      const { mintAddress } = req.params;
      const { period = '7d' } = req.query;

      const history = await this.analysisService.getHolderHistory(
        mintAddress,
        period as any
      );

      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      logger.error('Error fetching holder history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch holder history'
      });
    }
  }

  /**
   * GET /api/v1/holder-analysis/:mintAddress/trends
   * Get comprehensive trend analysis
   */
  async getTrends(req: Request, res: Response): Promise<void> {
    try {
      const { mintAddress } = req.params;
      const { period = '7d' } = req.query;

      const trends = await this.analysisService.analyzeTrends(
        mintAddress,
        period as any
      );

      res.json({
        success: true,
        data: trends
      });
    } catch (error) {
      logger.error('Error analyzing trends:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to analyze trends'
      });
    }
  }

  /**
   * GET /api/v1/holder-analysis/:mintAddress/comparison
   * Compare token with peer group
   */
  async compareToken(req: Request, res: Response): Promise<void> {
    try {
      const { mintAddress } = req.params;
      const { 
        minMarketCap,
        maxMarketCap,
        minHolders,
        maxHolders,
        limit = '20'
      } = req.query;

      const criteria = {
        marketCapRange: (minMarketCap || maxMarketCap) ? {
          min: Number(minMarketCap) || 0,
          max: Number(maxMarketCap) || Number.MAX_SAFE_INTEGER
        } : undefined,
        holderCountRange: (minHolders || maxHolders) ? {
          min: Number(minHolders) || 0,
          max: Number(maxHolders) || Number.MAX_SAFE_INTEGER
        } : undefined,
        limit: Number(limit)
      };

      const comparison = await this.comparisonService.compareToken(mintAddress, criteria);

      res.json({
        success: true,
        data: comparison
      });
    } catch (error) {
      logger.error('Error comparing token:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to compare token'
      });
    }
  }

  /**
   * GET /api/v1/holder-analysis/:mintAddress/report
   * Generate comprehensive holder report
   */
  async generateReport(req: Request, res: Response): Promise<void> {
    try {
      const { mintAddress } = req.params;
      const { period = '7d', format = 'json' } = req.query;

      if (format === 'markdown') {
        const report = await this.reportGenerator.generateMarkdownReport(
          mintAddress,
          period as any
        );
        
        res.setHeader('Content-Type', 'text/markdown');
        res.send(report);
      } else {
        const report = await this.reportGenerator.generateReport(
          mintAddress,
          period as any
        );

        res.json({
          success: true,
          data: report
        });
      }
    } catch (error) {
      logger.error('Error generating report:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate report'
      });
    }
  }

  /**
   * GET /api/v1/holder-analysis/alerts
   * Get active alerts across all tokens or specific token
   */
  async getAlerts(req: Request, res: Response): Promise<void> {
    try {
      const { mintAddress } = req.query;

      const alerts = await this.analysisService.getActiveAlerts(
        mintAddress as string | undefined
      );

      res.json({
        success: true,
        data: alerts
      });
    } catch (error) {
      logger.error('Error fetching alerts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch alerts'
      });
    }
  }

  /**
   * POST /api/v1/holder-analysis/alerts/:alertId/acknowledge
   * Acknowledge an alert
   */
  async acknowledgeAlert(req: Request, res: Response): Promise<void> {
    try {
      const { alertId } = req.params;

      await this.analysisService.acknowledgeAlert(Number(alertId));

      res.json({
        success: true,
        message: 'Alert acknowledged'
      });
    } catch (error) {
      logger.error('Error acknowledging alert:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to acknowledge alert'
      });
    }
  }

  /**
   * GET /api/v1/holder-analysis/:mintAddress/alerts/history
   * Get alert history for a token
   */
  async getAlertHistory(req: Request, res: Response): Promise<void> {
    try {
      const { mintAddress } = req.params;
      const { period = '7d' } = req.query;

      const alerts = await this.analysisService.getAlertHistory(
        mintAddress,
        period as any
      );

      res.json({
        success: true,
        data: alerts
      });
    } catch (error) {
      logger.error('Error fetching alert history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch alert history'
      });
    }
  }

  /**
   * GET /api/v1/holder-analysis/leaderboard
   * Get top tokens by holder score
   */
  async getLeaderboard(req: Request, res: Response): Promise<void> {
    try {
      const { limit = '100' } = req.query;

      const topTokens = await this.comparisonService.getTopTokensByScore(Number(limit));

      res.json({
        success: true,
        data: topTokens
      });
    } catch (error) {
      logger.error('Error fetching leaderboard:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch leaderboard'
      });
    }
  }
}