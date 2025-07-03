#!/usr/bin/env node

/**
 * Historical Data Recovery CLI
 * Recovers missed trades during downtime periods
 * 
 * Usage:
 *   npm run recover-history -- --detect
 *   npm run recover-history -- --from="2024-01-15 10:00" --to="2024-01-15 14:00"
 *   npm run recover-history -- --auto --hours=24
 */

import 'dotenv/config';
import { HistoricalRecoveryService } from '../services/recovery/historical-recovery';
import { db } from '../database';
import chalk from 'chalk';
import { parseISO, isValid, format } from 'date-fns';
import { program } from 'commander';

async function main() {
  const recoveryService = HistoricalRecoveryService.getInstance();
  
  program
    .name('recover-history')
    .description('Recover missed trades during downtime periods')
    .version('1.0.0');
  
  program
    .command('detect')
    .description('Detect downtime periods in trade data')
    .option('-h, --hours <number>', 'Hours to look back', '24')
    .option('-m, --min-gap <number>', 'Minimum gap in seconds', '300')
    .action(async (options) => {
      try {
        const hours = parseInt(options.hours);
        const minGap = parseInt(options.minGap);
        
        console.log(chalk.cyan.bold('\n🔍 Detecting Downtime Periods\n'));
        console.log(chalk.gray(`Looking back: ${hours} hours`));
        console.log(chalk.gray(`Minimum gap: ${minGap} seconds\n`));
        
        const periods = await recoveryService.detectDowntimePeriods(hours, minGap);
        
        if (periods.length === 0) {
          console.log(chalk.green('✅ No downtime periods found'));
          process.exit(0);
        }
        
        // Save detected periods to database
        console.log(chalk.blue('\n💾 Saving detected periods to database...'));
        
        for (const period of periods) {
          await db.query(`
            INSERT INTO downtime_periods (
              gap_start_slot,
              gap_end_slot,
              gap_start_time,
              gap_end_time,
              gap_duration_seconds,
              affected_programs,
              estimated_missed_trades
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (gap_start_slot, gap_end_slot) DO NOTHING
          `, [
            period.gap_start_slot,
            period.gap_end_slot,
            period.gap_start_time,
            period.gap_end_time,
            period.gap_duration_seconds,
            period.affected_programs,
            period.estimated_missed_trades
          ]);
        }
        
        console.log(chalk.green(`\n✅ Saved ${periods.length} downtime periods`));
        
      } catch (error) {
        console.error(chalk.red('❌ Detection failed:'), error);
        process.exit(1);
      }
    });
  
  program
    .command('recover')
    .description('Recover missed trades for a specific time period')
    .option('-f, --from <datetime>', 'Start time (YYYY-MM-DD HH:mm)')
    .option('-t, --to <datetime>', 'End time (YYYY-MM-DD HH:mm)')
    .option('-s, --start-slot <number>', 'Start slot')
    .option('-e, --end-slot <number>', 'End slot')
    .action(async (options) => {
      try {
        let period;
        
        if (options.from && options.to) {
          // Parse datetime strings
          const startTime = parseISO(options.from);
          const endTime = parseISO(options.to);
          
          if (!isValid(startTime) || !isValid(endTime)) {
            console.error(chalk.red('❌ Invalid date format. Use YYYY-MM-DD HH:mm'));
            process.exit(1);
          }
          
          period = {
            gap_start_time: startTime,
            gap_end_time: endTime,
            gap_start_slot: options.startSlot ? parseInt(options.startSlot) : 0,
            gap_end_slot: options.endSlot ? parseInt(options.endSlot) : 0,
            gap_duration_seconds: (endTime.getTime() - startTime.getTime()) / 1000,
            affected_programs: ['bonding_curve', 'amm_pool']
          };
        } else if (options.startSlot && options.endSlot) {
          // Get time from slots
          const slotInfo = await db.query(`
            SELECT 
              MIN(block_time) as start_time,
              MAX(block_time) as end_time
            FROM trades_unified
            WHERE slot BETWEEN $1 AND $2
          `, [parseInt(options.startSlot), parseInt(options.endSlot)]);
          
          if (!slotInfo.rows[0].start_time) {
            console.error(chalk.red('❌ No trades found for specified slot range'));
            process.exit(1);
          }
          
          period = {
            gap_start_slot: parseInt(options.startSlot),
            gap_end_slot: parseInt(options.endSlot),
            gap_start_time: slotInfo.rows[0].start_time,
            gap_end_time: slotInfo.rows[0].end_time,
            gap_duration_seconds: 0,
            affected_programs: ['bonding_curve', 'amm_pool']
          };
        } else {
          console.error(chalk.red('❌ Must specify either --from/--to or --start-slot/--end-slot'));
          process.exit(1);
        }
        
        // Run recovery
        const result = await recoveryService.recoverMissedTrades(period);
        
        if (result.totalTradesRecovered > 0) {
          console.log(chalk.green(`\n✅ Recovery successful!`));
        } else {
          console.log(chalk.yellow(`\n⚠️ No trades recovered`));
        }
        
      } catch (error) {
        console.error(chalk.red('❌ Recovery failed:'), error);
        process.exit(1);
      }
    });
  
  program
    .command('auto')
    .description('Automatically detect and recover recent downtime periods')
    .option('-h, --hours <number>', 'Hours to look back', '24')
    .option('-r, --recover', 'Automatically recover detected periods', false)
    .action(async (options) => {
      try {
        const hours = parseInt(options.hours);
        
        // Detect periods
        console.log(chalk.cyan.bold('\n🔍 Detecting Downtime Periods\n'));
        const periods = await recoveryService.detectDowntimePeriods(hours);
        
        if (periods.length === 0) {
          console.log(chalk.green('✅ No downtime periods found'));
          process.exit(0);
        }
        
        // Check for unrecovered periods
        const unrecoveredPeriods = [];
        for (const period of periods) {
          const existing = await db.query(`
            SELECT recovery_attempted
            FROM downtime_periods
            WHERE gap_start_slot = $1 AND gap_end_slot = $2
          `, [period.gap_start_slot, period.gap_end_slot]);
          
          if (!existing.rows[0]?.recovery_attempted) {
            unrecoveredPeriods.push(period);
          }
        }
        
        if (unrecoveredPeriods.length === 0) {
          console.log(chalk.green('✅ All detected periods have been recovered'));
          process.exit(0);
        }
        
        console.log(chalk.yellow(`\n⚠️ Found ${unrecoveredPeriods.length} unrecovered periods`));
        
        if (!options.recover) {
          console.log(chalk.gray('\nRun with --recover flag to automatically recover these periods'));
          process.exit(0);
        }
        
        // Recover each period
        let totalRecovered = 0;
        for (const period of unrecoveredPeriods) {
          console.log(chalk.gray('\n' + '─'.repeat(60) + '\n'));
          const result = await recoveryService.recoverMissedTrades(period);
          totalRecovered += result.totalTradesRecovered;
          
          // Mark as attempted
          await db.query(`
            UPDATE downtime_periods
            SET recovery_attempted = true
            WHERE gap_start_slot = $1 AND gap_end_slot = $2
          `, [period.gap_start_slot, period.gap_end_slot]);
        }
        
        console.log(chalk.green(`\n✅ Total trades recovered: ${totalRecovered}`));
        
      } catch (error) {
        console.error(chalk.red('❌ Auto recovery failed:'), error);
        process.exit(1);
      }
    });
  
  program
    .command('stats')
    .description('Show recovery statistics')
    .action(async () => {
      try {
        console.log(chalk.cyan.bold('\n📊 Recovery Statistics\n'));
        
        const stats = await recoveryService.getRecoveryStats();
        const history = await recoveryService.getRecoveryHistory(5);
        
        console.log(chalk.white('Overall Statistics:'));
        console.log(chalk.gray(`  Total Recoveries: ${stats.totalRecoveries}`));
        console.log(chalk.gray(`  Successful: ${stats.successfulRecoveries}`));
        console.log(chalk.gray(`  Trades Recovered: ${stats.totalTradesRecovered.toLocaleString()}`));
        console.log(chalk.gray(`  Avg Recovery Time: ${(stats.averageRecoveryTime / 60).toFixed(1)} minutes`));
        
        if (history.length > 0) {
          console.log(chalk.white('\nRecent Recovery History:'));
          history.forEach(rec => {
            const status = rec.status === 'completed' ? chalk.green('✓') : 
                          rec.status === 'failed' ? chalk.red('✗') : 
                          chalk.yellow('○');
            console.log(chalk.gray(
              `  ${status} ${format(rec.period_start, 'MM/dd HH:mm')} - ${format(rec.period_end, 'HH:mm')} ` +
              `(${rec.trades_recovered} trades)`
            ));
          });
        }
        
      } catch (error) {
        console.error(chalk.red('❌ Failed to get statistics:'), error);
        process.exit(1);
      }
    });
  
  // Parse arguments
  program.parse(process.argv);
  
  // Show help if no command specified
  if (!process.argv.slice(2).length) {
    program.outputHelp();
  }
}

// Run the CLI
main().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
}).finally(() => {
  // Ensure clean exit
  setTimeout(() => process.exit(0), 1000);
});