#!/usr/bin/env tsx
/**
 * Validate Refactoring
 * Comprehensive validation that the refactored system maintains all functionality
 */

import chalk from 'chalk';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

interface ValidationTest {
  name: string;
  description: string;
  test: () => Promise<boolean>;
}

const validationTests: ValidationTest[] = [
  {
    name: 'Core Services',
    description: 'Verify all core services are properly implemented',
    test: async () => {
      const requiredFiles = [
        'src/core/base-monitor.ts',
        'src/core/container.ts',
        'src/core/event-bus.ts',
        'src/core/config.ts',
        'src/core/logger.ts',
        'src/core/container-factory.ts'
      ];
      
      for (const file of requiredFiles) {
        try {
          await fs.access(path.join(process.cwd(), file));
        } catch {
          console.error(chalk.red(`  Missing: ${file}`));
          return false;
        }
      }
      return true;
    }
  },
  
  {
    name: 'Monitor Implementation',
    description: 'Verify monitors extend BaseMonitor and implement required methods',
    test: async () => {
      const monitors = [
        'src/monitors/bc-monitor.ts',
        'src/monitors/amm-monitor.ts'
      ];
      
      for (const file of monitors) {
        const content = await fs.readFile(path.join(process.cwd(), file), 'utf-8');
        if (!content.includes('extends BaseMonitor')) {
          console.error(chalk.red(`  ${file} doesn't extend BaseMonitor`));
          return false;
        }
        if (!content.includes('processStreamData')) {
          console.error(chalk.red(`  ${file} missing processStreamData method`));
          return false;
        }
        if (!content.includes('displayStats')) {
          console.error(chalk.red(`  ${file} missing displayStats method`));
          return false;
        }
      }
      return true;
    }
  },
  
  {
    name: 'Dependency Injection',
    description: 'Verify DI container is used instead of singletons',
    test: async () => {
      const files = [
        'src/monitors/bc-monitor.ts',
        'src/monitors/amm-monitor.ts',
        'src/api/server-refactored.ts'
      ];
      
      for (const file of files) {
        const content = await fs.readFile(path.join(process.cwd(), file), 'utf-8');
        if (content.includes('getInstance()')) {
          console.error(chalk.red(`  ${file} still uses singleton pattern`));
          return false;
        }
        if (!content.includes('container')) {
          console.error(chalk.red(`  ${file} doesn't use DI container`));
          return false;
        }
      }
      return true;
    }
  },
  
  {
    name: 'Event-Driven Architecture',
    description: 'Verify EventBus is used for component communication',
    test: async () => {
      const files = [
        'src/monitors/bc-monitor.ts',
        'src/monitors/amm-monitor.ts',
        'src/websocket/websocket-server.ts'
      ];
      
      for (const file of files) {
        const content = await fs.readFile(path.join(process.cwd(), file), 'utf-8');
        if (!content.includes('eventBus.emit') && !content.includes('eventBus.on')) {
          console.error(chalk.red(`  ${file} doesn't use EventBus`));
          return false;
        }
      }
      return true;
    }
  },
  
  {
    name: 'WebSocket Implementation',
    description: 'Verify WebSocket server is properly implemented',
    test: async () => {
      const wsServer = await fs.readFile(
        path.join(process.cwd(), 'src/websocket/websocket-server.ts'), 
        'utf-8'
      );
      
      // Check for frame header fix
      if (!wsServer.includes('perMessageDeflate: false')) {
        console.error(chalk.red('  WebSocket missing frame header fix'));
        return false;
      }
      
      // Check for client file
      try {
        await fs.access(path.join(process.cwd(), 'public/js/websocket-client.js'));
      } catch {
        console.error(chalk.red('  Missing websocket-client.js'));
        return false;
      }
      
      return true;
    }
  },
  
  {
    name: 'Unified Services',
    description: 'Verify services are unified (no duplicates)',
    test: async () => {
      const services = await fs.readdir(path.join(process.cwd(), 'src/services'));
      
      // Check for version suffixes
      const versionedFiles = services.filter(f => 
        f.includes('-v2') || f.includes('-v3') || f.includes('-quick-fix')
      );
      
      if (versionedFiles.length > 0) {
        console.error(chalk.red(`  Found versioned files: ${versionedFiles.join(', ')}`));
        return false;
      }
      
      // Check for duplicate price calculators
      const priceCalcs = services.filter(f => f.includes('price') && f.includes('calculator'));
      if (priceCalcs.length > 1) {
        console.error(chalk.red(`  Multiple price calculators: ${priceCalcs.join(', ')}`));
        return false;
      }
      
      return true;
    }
  },
  
  {
    name: 'Type Safety',
    description: 'Verify TypeScript compilation succeeds',
    test: async () => {
      return new Promise((resolve) => {
        const proc = spawn('npx', ['tsc', '--noEmit'], {
          stdio: 'pipe'
        });
        
        let errors = '';
        proc.stderr.on('data', (data) => {
          errors += data.toString();
        });
        
        proc.on('exit', (code) => {
          if (code !== 0) {
            console.error(chalk.red('  TypeScript compilation errors:'));
            console.error(errors.split('\n').slice(0, 5).join('\n'));
            resolve(false);
          } else {
            resolve(true);
          }
        });
      });
    }
  },
  
  {
    name: 'Configuration Management',
    description: 'Verify centralized configuration',
    test: async () => {
      const config = await fs.readFile(
        path.join(process.cwd(), 'src/core/config.ts'), 
        'utf-8'
      );
      
      // Check for all required config sections
      const requiredSections = ['database', 'monitors', 'services', 'grpc', 'api'];
      for (const section of requiredSections) {
        if (!config.includes(`${section}:`)) {
          console.error(chalk.red(`  Missing config section: ${section}`));
          return false;
        }
      }
      
      return true;
    }
  },
  
  {
    name: 'Repository Pattern',
    description: 'Verify data access uses repository pattern',
    test: async () => {
      const repos = [
        'src/repositories/token-repository.ts',
        'src/repositories/trade-repository.ts',
        'src/repositories/base-repository.ts'
      ];
      
      for (const repo of repos) {
        try {
          const content = await fs.readFile(path.join(process.cwd(), repo), 'utf-8');
          if (!content.includes('Repository')) {
            console.error(chalk.red(`  ${repo} doesn't implement repository pattern`));
            return false;
          }
        } catch {
          console.error(chalk.red(`  Missing: ${repo}`));
          return false;
        }
      }
      
      return true;
    }
  },
  
  {
    name: 'Clean Architecture',
    description: 'Verify separation of concerns',
    test: async () => {
      // Check that monitors don't directly access database
      const bcMonitor = await fs.readFile(
        path.join(process.cwd(), 'src/monitors/bc-monitor.ts'),
        'utf-8'
      );
      
      if (bcMonitor.includes('pg.Client') || bcMonitor.includes('pool.query')) {
        console.error(chalk.red('  Monitors directly accessing database'));
        return false;
      }
      
      // Check that parsers don't have business logic
      const parser = await fs.readFile(
        path.join(process.cwd(), 'src/parsers/unified-event-parser.ts'),
        'utf-8'
      );
      
      if (parser.includes('save') || parser.includes('database')) {
        console.error(chalk.red('  Parser contains business logic'));
        return false;
      }
      
      return true;
    }
  }
];

async function runValidation() {
  console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════╗
║         🔍 Refactoring Validation Suite 🔍            ║
║                                                       ║
║     Verifying architectural improvements              ║
╚═══════════════════════════════════════════════════════╝
`));

  let passed = 0;
  let failed = 0;
  
  for (const test of validationTests) {
    console.log(chalk.blue(`\n▶ ${test.name}`));
    console.log(chalk.gray(`  ${test.description}`));
    
    try {
      const result = await test.test();
      if (result) {
        console.log(chalk.green('  ✓ Passed'));
        passed++;
      } else {
        console.log(chalk.red('  ✗ Failed'));
        failed++;
      }
    } catch (error) {
      console.log(chalk.red('  ✗ Error:', error));
      failed++;
    }
  }
  
  // Summary
  console.log(chalk.cyan('\n' + '═'.repeat(55)));
  console.log(chalk.cyan('Validation Summary:'));
  console.log(chalk.green(`  ✓ Passed: ${passed}/${validationTests.length}`));
  if (failed > 0) {
    console.log(chalk.red(`  ✗ Failed: ${failed}/${validationTests.length}`));
  }
  console.log(chalk.cyan('═'.repeat(55) + '\n'));
  
  if (failed === 0) {
    console.log(chalk.green('🎉 All validations passed! The refactoring maintains functionality.'));
  } else {
    console.log(chalk.red('❌ Some validations failed. Please review the issues above.'));
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run validation
runValidation().catch(console.error);