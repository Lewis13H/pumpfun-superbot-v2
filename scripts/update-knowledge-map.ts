#!/usr/bin/env tsx
/**
 * Update Knowledge Map in CLAUDE.md
 * Scans for all .knowledge directories and updates the knowledge map section
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

interface KnowledgeLocation {
  path: string;
  description: string;
  files: string[];
}

// Directories to exclude from scanning
const EXCLUDE_DIRS = ['node_modules', 'dist', '.git', '.next', 'coverage'];

function findKnowledgeDirectories(dir: string, basePath: string = ''): KnowledgeLocation[] {
  const locations: KnowledgeLocation[] = [];
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.join(basePath, entry.name);
        
        // Skip excluded directories
        if (EXCLUDE_DIRS.includes(entry.name)) {
          continue;
        }
        
        // Check if this is a .knowledge directory
        if (entry.name === '.knowledge') {
          const knowledgeFiles = fs.readdirSync(fullPath)
            .filter(f => f.endsWith('.md'))
            .filter(f => f !== 'README.md'); // README handled separately
          
          // Always include .knowledge directories that have any .md files
          const hasReadme = fs.existsSync(path.join(fullPath, 'README.md'));
          if (knowledgeFiles.length > 0 || hasReadme) {
            // Try to get description from README.md
            let description = 'Documentation and insights';
            const readmePath = path.join(fullPath, 'README.md');
            if (fs.existsSync(readmePath)) {
              const readmeContent = fs.readFileSync(readmePath, 'utf-8');
              const overviewMatch = readmeContent.match(/## Overview\n(.+?)(?:\n|$)/);
              if (overviewMatch) {
                description = overviewMatch[1].trim();
              } else {
                // Try first paragraph
                const firstParagraph = readmeContent.split('\n\n')[1];
                if (firstParagraph && !firstParagraph.startsWith('#')) {
                  description = firstParagraph.replace(/\n/g, ' ').substring(0, 100);
                  if (description.length === 100) description += '...';
                }
              }
            }
            
            locations.push({
              path: `/${basePath}`,
              description,
              files: knowledgeFiles
            });
          }
        } else {
          // Recursively search subdirectories
          const subLocations = findKnowledgeDirectories(fullPath, relativePath);
          locations.push(...subLocations);
        }
      }
    }
  } catch (error) {
    console.error(chalk.red(`Error scanning ${dir}:`), error);
  }
  
  return locations;
}

function generateKnowledgeMap(locations: KnowledgeLocation[]): string {
  let content = '';
  
  // Group by major directories
  const grouped = new Map<string, KnowledgeLocation[]>();
  
  for (const loc of locations) {
    const parts = loc.path.split('/').filter(Boolean);
    const category = parts[0] || 'root';
    
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)!.push(loc);
  }
  
  // Generate content for each group
  for (const [category, locs] of grouped) {
    const categoryName = getCategoryName(category);
    
    for (const loc of locs) {
      const topics = loc.files.map(f => f.replace('.md', '').replace(/-/g, ' '));
      const topicsList = topics.length > 0 ? topics.join(', ') : 'General documentation';
      
      content += `- **${categoryName}**: \`${loc.path}/.knowledge/\` - ${topicsList}\n`;
    }
  }
  
  return content;
}

function getCategoryName(category: string): string {
  const names: Record<string, string> = {
    'src': 'Source Code',
    'monitors': 'Monitor Insights',
    'services': 'Service Documentation',
    'database': 'Database Knowledge',
    'scripts': 'Script Documentation',
    'docs': 'Documentation',
    'api': 'API Documentation',
    'utils': 'Utilities Knowledge',
    'root': 'Project Root'
  };
  
  return names[category] || category.charAt(0).toUpperCase() + category.slice(1);
}

function updateClaudeMd(knowledgeMap: string) {
  const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md');
  
  if (!fs.existsSync(claudeMdPath)) {
    console.error(chalk.red('CLAUDE.md not found!'));
    process.exit(1);
  }
  
  const content = fs.readFileSync(claudeMdPath, 'utf-8');
  
  // Find the auto-generated section
  const startMarker = '<!-- AUTO-GENERATED-KNOWLEDGE-START -->';
  const endMarker = '<!-- AUTO-GENERATED-KNOWLEDGE-END -->';
  
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);
  
  if (startIndex === -1 || endIndex === -1) {
    console.error(chalk.red('Knowledge map markers not found in CLAUDE.md!'));
    console.log(chalk.yellow('Make sure CLAUDE.md contains:'));
    console.log(chalk.gray(startMarker));
    console.log(chalk.gray('...'));
    console.log(chalk.gray(endMarker));
    process.exit(1);
  }
  
  // Replace the content between markers
  const before = content.substring(0, startIndex + startMarker.length);
  const after = content.substring(endIndex);
  
  const newContent = before + '\n' + knowledgeMap + after;
  
  fs.writeFileSync(claudeMdPath, newContent);
  
  console.log(chalk.green('✅ Updated CLAUDE.md knowledge map'));
}

// Main execution
async function main() {
  console.log(chalk.blue('🔍 Scanning for .knowledge directories...\n'));
  
  const projectRoot = process.cwd();
  const locations = findKnowledgeDirectories(projectRoot);
  
  if (locations.length === 0) {
    console.log(chalk.yellow('No .knowledge directories found!'));
    console.log(chalk.gray('Create .knowledge directories with .md files to document your code.'));
    return;
  }
  
  console.log(chalk.cyan(`Found ${locations.length} knowledge locations:\n`));
  
  for (const loc of locations) {
    console.log(chalk.white(`📁 ${loc.path}/.knowledge/`));
    if (loc.files.length > 0) {
      console.log(chalk.gray(`   Files: ${loc.files.join(', ')}`));
    }
    console.log();
  }
  
  const knowledgeMap = generateKnowledgeMap(locations);
  
  console.log(chalk.blue('📝 Updating CLAUDE.md...\n'));
  updateClaudeMd(knowledgeMap);
  
  console.log(chalk.green('\n✨ Knowledge map updated successfully!'));
  console.log(chalk.gray('\nTip: Run this script whenever you add new .knowledge directories.'));
}

main().catch(error => {
  console.error(chalk.red('Error:'), error);
  process.exit(1);
});