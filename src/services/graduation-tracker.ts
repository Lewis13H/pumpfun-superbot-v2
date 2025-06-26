import { db } from '../database';
import { MigrationDetector, MigrationEvent } from '../utils/migration-detector';

export class GraduationTracker {
  private static instance: GraduationTracker;
  private migrationDetector: MigrationDetector;
  private graduatedTokens: Set<string> = new Set();

  private constructor() {
    this.migrationDetector = new MigrationDetector();
    this.loadGraduatedTokens();
  }

  static getInstance(): GraduationTracker {
    if (!GraduationTracker.instance) {
      GraduationTracker.instance = new GraduationTracker();
    }
    return GraduationTracker.instance;
  }

  /**
   * Load already graduated tokens from database
   */
  private async loadGraduatedTokens(): Promise<void> {
    try {
      const result = await db.query(`
        SELECT DISTINCT mint 
        FROM tokens 
        WHERE graduated = true
      `);
      
      for (const row of result.rows) {
        this.graduatedTokens.add(row.mint);
      }
      
      console.log(`📚 Loaded ${this.graduatedTokens.size} graduated tokens`);
    } catch (error) {
      console.error('Error loading graduated tokens:', error);
    }
  }

  /**
   * Check if a token has graduated
   */
  isGraduated(mint: string): boolean {
    return this.graduatedTokens.has(mint);
  }

  /**
   * Process a potential migration transaction
   */
  async processMigration(transaction: any): Promise<boolean> {
    const migrationData = this.migrationDetector.extractMigrationData(transaction);
    
    if (!migrationData) {
      return false;
    }

    console.log(`\n🎓 TOKEN GRADUATED! ${migrationData.mint}`);
    console.log(`   Pool: ${migrationData.pool}`);
    console.log(`   SOL Amount: ${Number(migrationData.solAmount) / 1e9} SOL`);
    console.log(`   Timestamp: ${new Date(Number(migrationData.timestamp) * 1000).toISOString()}`);

    // Mark token as graduated
    this.graduatedTokens.add(migrationData.mint);

    // Update database
    await this.saveGraduation(migrationData);

    return true;
  }

  /**
   * Save graduation event to database
   */
  private async saveGraduation(event: MigrationEvent): Promise<void> {
    try {
      // Update token as graduated
      await db.query(`
        UPDATE tokens 
        SET 
          graduated = true,
          graduation_time = TO_TIMESTAMP($1),
          pool_address = $2,
          graduation_sol_amount = $3
        WHERE address = $4
      `, [
        Number(event.timestamp),
        event.pool,
        Number(event.solAmount) / 1e9,
        event.mint
      ]);

      // Insert graduation event
      await db.query(`
        INSERT INTO graduation_events (
          mint,
          user_address,
          pool_address,
          sol_amount,
          mint_amount,
          pool_migration_fee,
          bonding_curve,
          timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, TO_TIMESTAMP($8))
        ON CONFLICT (mint) DO NOTHING
      `, [
        event.mint,
        event.user,
        event.pool,
        Number(event.solAmount) / 1e9,
        event.mintAmount.toString(),
        Number(event.poolMigrationFee) / 1e9,
        event.bondingCurve,
        Number(event.timestamp)
      ]);

      console.log(`💾 Saved graduation event for ${event.mint}`);
    } catch (error) {
      console.error('Error saving graduation:', error);
    }
  }

  /**
   * Get graduation details for a token
   */
  async getGraduationDetails(mint: string): Promise<any> {
    try {
      const result = await db.query(`
        SELECT * FROM graduation_events WHERE mint = $1
      `, [mint]);

      return result.rows[0] || null;
    } catch (error) {
      console.error('Error fetching graduation details:', error);
      return null;
    }
  }
}