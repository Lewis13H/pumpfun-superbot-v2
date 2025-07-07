# Codebase Knowledge Structure

## Concept: Directory-Mirrored Knowledge Base

Instead of a single knowledge repository, create `.knowledge/` directories throughout the codebase that contain Markdown files with contextual information about that specific section.

## Proposed Structure

```
src/
├── monitors/
│   ├── domain/
│   │   ├── .knowledge/
│   │   │   ├── README.md                    # Overview of domain monitors
│   │   │   ├── token-lifecycle.md           # How token lifecycle monitoring works
│   │   │   ├── trading-patterns.md          # MEV detection, trading strategies
│   │   │   ├── troubleshooting.md          # Common issues and solutions
│   │   │   └── performance-notes.md        # Optimization insights
│   │   ├── token-lifecycle-monitor.ts
│   │   ├── trading-activity-monitor.ts
│   │   └── liquidity-monitor.ts
│   │
├── services/
│   ├── pricing/
│   │   ├── .knowledge/
│   │   │   ├── README.md                    # Pricing architecture overview
│   │   │   ├── bonding-curve-math.md       # Mathematical formulas explained
│   │   │   ├── price-accuracy.md           # Notes on price calculation accuracy
│   │   │   ├── amm-vs-bc-pricing.md        # Differences between AMM and BC
│   │   │   └── edge-cases.md              # Known edge cases and handling
│   │   ├── price-calculator.ts
│   │   └── sol-price-service.ts
│   │
│   ├── metadata/
│   │   ├── .knowledge/
│   │   │   ├── README.md                    # Metadata enrichment strategy
│   │   │   ├── api-comparison.md           # Shyft vs Helius vs RPC
│   │   │   ├── rate-limiting.md            # Rate limit strategies
│   │   │   ├── token-creation-time.md      # Why creation time is tricky
│   │   │   └── enrichment-queue.md         # Queue management insights
│   │   └── enhanced-auto-enricher.ts
│   │
│   └── pipeline/
│       ├── .knowledge/
│       │   ├── README.md                    # Data pipeline architecture
│       │   ├── event-flow.md               # How events flow through system
│       │   ├── batching-strategy.md        # Optimal batch sizes
│       │   └── performance-tuning.md       # Tuning recommendations
│       └── data-pipeline.ts
│
├── database/
│   ├── .knowledge/
│   │   ├── README.md                        # Database design decisions
│   │   ├── schema-evolution.md             # How schema evolved over time
│   │   ├── query-optimization.md           # Slow queries and solutions
│   │   ├── data-retention.md               # What to keep vs archive
│   │   └── migration-notes.md              # Migration gotchas
│   └── unified-db-service.ts
│
└── .knowledge/
    ├── README.md                            # Project-wide knowledge base
    ├── architecture-decisions.md            # ADRs (Architecture Decision Records)
    ├── deployment-lessons.md                # Production deployment insights
    ├── incident-reports.md                  # Post-mortems and learnings
    └── future-ideas.md                      # Features and improvements backlog
```

## Benefits

1. **Contextual Knowledge**: Information is stored right where it's needed
2. **Discoverability**: Developers exploring a module immediately see its knowledge base
3. **Maintainability**: Knowledge updates happen alongside code changes
4. **AI-Friendly**: AI assistants can easily access relevant context when working on specific sections
5. **Version Control**: Knowledge evolves with the code in Git
6. **Progressive Documentation**: Start small, grow organically

## Knowledge File Types

### README.md
- Overview of the module/directory
- Key concepts and responsibilities
- Links to related knowledge files

### Technical Deep Dives
- `*-math.md`: Mathematical formulas and algorithms
- `*-architecture.md`: Design patterns and structure
- `*-flow.md`: Data/control flow explanations

### Operational Knowledge
- `troubleshooting.md`: Common issues and solutions
- `performance-notes.md`: Optimization insights
- `edge-cases.md`: Weird scenarios and how to handle them

### Historical Context
- `evolution.md`: How this module evolved
- `migration-notes.md`: Breaking changes and migrations
- `deprecated.md`: What was removed and why

### External Integration
- `api-notes.md`: External API quirks and gotchas
- `rate-limiting.md`: Rate limit strategies
- `error-handling.md`: How to handle external failures

## Implementation Strategy

### Phase 1: Core Modules
Start with the most complex modules:
- `monitors/domain/.knowledge/`
- `services/pricing/.knowledge/`
- `services/metadata/.knowledge/`

### Phase 2: Expand Coverage
- Add knowledge bases to all service directories
- Create database and API knowledge bases

### Phase 3: Integration
- Build tooling to search across all knowledge bases
- Create AI prompts that automatically include relevant knowledge
- Add VSCode extension for quick knowledge access

## Example Knowledge File

### `/src/services/pricing/.knowledge/bonding-curve-math.md`

```markdown
# Bonding Curve Mathematics

## Overview
Pump.fun uses a constant product bonding curve similar to Uniswap V2.

## Key Formula
```
k = x * y
```
Where:
- k = constant product
- x = SOL reserves
- y = token reserves

## Price Calculation
Current price = SOL reserves / token reserves

## Progress Calculation
- Start: ~30 SOL in curve
- Complete: ~84 SOL in curve (per Shyft examples)
- Progress = (current_sol / 84) * 100

## Common Misconceptions
1. **Not 85 SOL**: Despite common belief, graduation happens at ~84 SOL
2. **Virtual vs Real**: Reserves are virtual until graduation
3. **Price Impact**: Every trade moves the price along the curve

## Edge Cases
- Progress can show >100% if calculation is off
- Some tokens graduate at different thresholds
- Market cap != SOL in curve (common confusion)

## References
- [Pump.fun Docs](...)
- [Shyft Examples](...)
- See: price-calculator.ts line 44
```

## Tools and Automation

### Knowledge Search Tool
```bash
# Search all knowledge bases
./scripts/search-knowledge.sh "bonding curve"

# Generate knowledge map
./scripts/generate-knowledge-map.sh > KNOWLEDGE_MAP.md
```

### AI Context Builder
```typescript
// Automatically include relevant knowledge when working on a file
function getRelevantKnowledge(filePath: string): string[] {
  const dir = path.dirname(filePath);
  const knowledgeDir = path.join(dir, '.knowledge');
  // ... load relevant .md files
}
```

## Best Practices

1. **Keep it Contextual**: Knowledge should be specific to its directory
2. **Link Don't Duplicate**: Reference other knowledge files rather than copying
3. **Code References**: Include specific file:line references
4. **Update Together**: When changing code, update relevant knowledge
5. **Question-Driven**: Write knowledge that answers real questions you've had

## Migration from CLAUDE.md

The current CLAUDE.md could be split into:
- Project overview → `/.knowledge/README.md`
- Architecture → `/.knowledge/architecture-decisions.md`
- Individual service details → respective `.knowledge/` directories
- Scripts documentation → `/scripts/.knowledge/`

This distributed approach would make the knowledge base more maintainable and accessible.