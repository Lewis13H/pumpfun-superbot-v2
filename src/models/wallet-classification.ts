/**
 * Wallet Classification Model
 * 
 * Model class for managing wallet classifications in the database
 */

import { Pool } from 'pg';
import { 
  WalletClassificationData,
  WalletClassification,
  WalletSubClassification,
  WalletDetectionMetadata 
} from '../types/holder-analysis';

export class WalletClassificationModel {
  constructor(private pool: Pool) {}

  /**
   * Create or update a wallet classification
   */
  async upsert(classification: WalletClassificationData): Promise<WalletClassificationData> {
    const query = `
      INSERT INTO wallet_classifications (
        wallet_address,
        classification,
        sub_classification,
        confidence_score,
        detection_metadata,
        first_seen,
        last_activity,
        total_tokens_traded,
        suspicious_activity_count,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (wallet_address) DO UPDATE SET
        classification = EXCLUDED.classification,
        sub_classification = EXCLUDED.sub_classification,
        confidence_score = EXCLUDED.confidence_score,
        detection_metadata = EXCLUDED.detection_metadata,
        last_activity = EXCLUDED.last_activity,
        total_tokens_traded = EXCLUDED.total_tokens_traded,
        suspicious_activity_count = EXCLUDED.suspicious_activity_count,
        updated_at = NOW()
      RETURNING *
    `;

    const values = [
      classification.walletAddress,
      classification.classification,
      classification.subClassification,
      classification.confidenceScore,
      JSON.stringify(classification.detectionMetadata),
      classification.firstSeen,
      classification.lastActivity,
      classification.totalTokensTraded,
      classification.suspiciousActivityCount
    ];

    const result = await this.pool.query(query, values);
    return this.mapRowToClassification(result.rows[0]);
  }

  /**
   * Get classification for a wallet
   */
  async get(walletAddress: string): Promise<WalletClassificationData | null> {
    const query = `
      SELECT * FROM wallet_classifications
      WHERE wallet_address = $1
    `;

    const result = await this.pool.query(query, [walletAddress]);
    return result.rows.length > 0 ? this.mapRowToClassification(result.rows[0]) : null;
  }

  /**
   * Get multiple wallet classifications
   */
  async getBatch(walletAddresses: string[]): Promise<Map<string, WalletClassificationData>> {
    if (walletAddresses.length === 0) return new Map();

    const query = `
      SELECT * FROM wallet_classifications
      WHERE wallet_address = ANY($1)
    `;

    const result = await this.pool.query(query, [walletAddresses]);
    const map = new Map<string, WalletClassificationData>();
    
    result.rows.forEach(row => {
      map.set(row.wallet_address, this.mapRowToClassification(row));
    });

    return map;
  }

  /**
   * Get wallets by classification type
   */
  async getByClassification(
    classification: WalletClassification,
    limit: number = 100,
    offset: number = 0
  ): Promise<WalletClassificationData[]> {
    const query = `
      SELECT * FROM wallet_classifications
      WHERE classification = $1
      ORDER BY last_activity DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await this.pool.query(query, [classification, limit, offset]);
    return result.rows.map(row => this.mapRowToClassification(row));
  }

  /**
   * Get suspicious wallets
   */
  async getSuspicious(minActivityCount: number = 5): Promise<WalletClassificationData[]> {
    const query = `
      SELECT * FROM wallet_classifications
      WHERE suspicious_activity_count >= $1
      ORDER BY suspicious_activity_count DESC
    `;

    const result = await this.pool.query(query, [minActivityCount]);
    return result.rows.map(row => this.mapRowToClassification(row));
  }

  /**
   * Update suspicious activity count
   */
  async incrementSuspiciousActivity(walletAddress: string): Promise<void> {
    const query = `
      UPDATE wallet_classifications
      SET 
        suspicious_activity_count = suspicious_activity_count + 1,
        last_activity = NOW(),
        updated_at = NOW()
      WHERE wallet_address = $1
    `;

    await this.pool.query(query, [walletAddress]);
  }

  /**
   * Get classification statistics
   */
  async getStatistics(): Promise<{
    classification: WalletClassification;
    count: number;
    avgConfidence: number;
  }[]> {
    const query = `
      SELECT 
        classification,
        COUNT(*) as count,
        AVG(confidence_score) as avg_confidence
      FROM wallet_classifications
      GROUP BY classification
      ORDER BY count DESC
    `;

    const result = await this.pool.query(query);
    return result.rows.map(row => ({
      classification: row.classification as WalletClassification,
      count: parseInt(row.count),
      avgConfidence: parseFloat(row.avg_confidence)
    }));
  }

  /**
   * Find associated wallets (wallets that frequently interact)
   */
  async findAssociatedWallets(
    walletAddress: string,
    _tokenMintAddress?: string
  ): Promise<string[]> {
    // This would typically analyze transaction patterns
    // For now, return wallets stored in metadata
    const wallet = await this.get(walletAddress);
    if (!wallet) return [];

    return wallet.detectionMetadata.associatedWallets || [];
  }

  /**
   * Bulk classify wallets as unknown (for initialization)
   */
  async bulkInitialize(walletAddresses: string[]): Promise<number> {
    if (walletAddresses.length === 0) return 0;

    const values = walletAddresses.map(address => 
      `('${address}', 'unknown', 0.0, '{}', NOW())`
    ).join(',');

    const query = `
      INSERT INTO wallet_classifications 
        (wallet_address, classification, confidence_score, detection_metadata, first_seen)
      VALUES ${values}
      ON CONFLICT (wallet_address) DO NOTHING
    `;

    const result = await this.pool.query(query);
    return result.rowCount || 0;
  }

  /**
   * Update classification confidence
   */
  async updateConfidence(
    walletAddress: string,
    newConfidence: number,
    additionalMetadata?: Partial<WalletDetectionMetadata>
  ): Promise<void> {
    const current = await this.get(walletAddress);
    if (!current) return;

    const updatedMetadata = {
      ...current.detectionMetadata,
      ...additionalMetadata
    };

    const query = `
      UPDATE wallet_classifications
      SET 
        confidence_score = $1,
        detection_metadata = $2,
        updated_at = NOW()
      WHERE wallet_address = $3
    `;

    await this.pool.query(query, [
      newConfidence,
      JSON.stringify(updatedMetadata),
      walletAddress
    ]);
  }

  /**
   * Clean up old unknown classifications
   */
  async cleanupUnknown(daysOld: number = 30): Promise<number> {
    const query = `
      DELETE FROM wallet_classifications
      WHERE classification = 'unknown'
        AND confidence_score = 0
        AND last_activity < NOW() - INTERVAL '${daysOld} days'
    `;

    const result = await this.pool.query(query);
    return result.rowCount || 0;
  }

  /**
   * Map database row to WalletClassificationData interface
   */
  private mapRowToClassification(row: any): WalletClassificationData {
    return {
      walletAddress: row.wallet_address,
      classification: row.classification as WalletClassification,
      subClassification: row.sub_classification as WalletSubClassification | undefined,
      confidenceScore: parseFloat(row.confidence_score),
      detectionMetadata: row.detection_metadata as WalletDetectionMetadata,
      firstSeen: new Date(row.first_seen),
      lastActivity: row.last_activity ? new Date(row.last_activity) : undefined,
      totalTokensTraded: parseInt(row.total_tokens_traded),
      suspiciousActivityCount: parseInt(row.suspicious_activity_count),
      updatedAt: new Date(row.updated_at)
    };
  }
}