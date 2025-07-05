# Service & Utils Directory Rebuild Plan

## Overview
This plan outlines the consolidation and reorganization of the `src/services/` and `src/utils/` directories to create a cleaner, more maintainable codebase. The goal is to reduce file count from ~59 to ~43 files while improving code organization.

## Current State
- **Services**: 40 files across 8 subdirectories
- **Utils**: 19 files across 5 subdirectories
- **Total**: 59 files

## Target State
- **Services**: ~28 files (30% reduction)
- **Utils**: ~15 files (21% reduction)
- **Total**: ~43 files (27% reduction overall)

## Services Directory Consolidation Plan

### Phase 1: High Priority Consolidations (Quick Wins)

#### 1.1 Pricing Services Consolidation
**Files to merge:**
- `bc-price-calculator.ts` (215 lines) → `price-calculator.ts`
- `amm-graphql-price-calculator.ts` (131 lines) → `enhanced-amm-price-calculator.ts`

**Actions:**
1. Move BC-specific logic from `bc-price-calculator.ts` into `price-calculator.ts` as methods
2. Integrate GraphQL price logic into `enhanced-amm-price-calculator.ts`
3. Update all imports throughout codebase
4. Delete original files

**Result**: 7 → 5 files in pricing/

#### 1.2 Metadata Services Consolidation
**Files to merge:**
- `providers/shyft-metadata-service.ts` (228 lines) → `providers/shyft-das-service.ts`

**Actions:**
1. Create unified `shyft-provider.ts` combining both Shyft services
2. Maintain separate methods for DAS vs standard metadata
3. Update dependency injection configuration
4. Delete original files

**Result**: 4 → 3 files in metadata/

#### 1.3 Token Management Consolidation
**Files to merge:**
- `graduation-fixer-service.ts` (179 lines) → `token-lifecycle-service.ts`
- `token-creation-detector.ts` (359 lines) + `token-creation-time-service.ts` (264 lines) → `token-creation-service.ts`

**Actions:**
1. Add graduation fixing methods to lifecycle service
2. Combine creation detection and time fetching into single service
3. Update event emitters and listeners
4. Delete original files

**Result**: 6 → 4 files in token-management/

### Phase 2: Medium Priority Consolidations

#### 2.1 AMM Services Consolidation
**Files to merge:**
- `amm-fee-service.ts` (343 lines) + `lp-position-calculator.ts` (297 lines) → `amm-pool-analytics.ts`

**Actions:**
1. Move fee tracking logic into analytics service
2. Move LP calculation methods into analytics service
3. Ensure no circular dependencies
4. Update all dependent services

**Result**: 4 → 2 files in amm/

#### 2.2 Recovery Services Consolidation
**Files to merge:**
- `recovery-queue.ts` (195 lines) → `historical-recovery.ts`

**Actions:**
1. Integrate queue logic as private class within historical recovery
2. Maintain same public API
3. Update recovery initialization

**Result**: 4 → 3 files in recovery/

#### 2.3 Monitoring Services Consolidation
**Files to merge:**
- `bc-monitor-stats-aggregator.ts` (335 lines) → `performance-monitor.ts`

**Actions:**
1. Add BC-specific stats as methods in performance monitor
2. Maintain separate namespaces for different monitor types
3. Update dashboard API endpoints

**Result**: 5 → 4 files in monitoring/

#### 2.4 Core Services Consolidation
**Files to merge:**
- `event-parser-service.ts` (540 lines) + `inner-ix-parser.ts` (336 lines) → `transaction-parser-service.ts`

**Actions:**
1. Combine parsing logic into unified service
2. Maintain separate methods for events vs inner instructions
3. Update all monitor dependencies

**Result**: 7 → 6 files in core/

## Utils Directory Reorganization Plan

### Phase 3: Utils Consolidation

#### 3.1 AMM Utils Consolidation
**Files to merge:**
- `amm/event-decoder.ts` (4.4K) + `amm/pool-decoder.ts` (2.2K) + `amm/price-calculator.ts` (6.5K) → `amm/amm-utils.ts`

**Actions:**
1. Create namespace exports for each utility type
2. Combine related interfaces and types
3. Update all imports to use namespace imports

**Result**: 3 → 1 file in amm/

#### 3.2 Parser Consolidation
**Files to merge:**
- `parsers/event-parser.ts` (3.3K) + `parsers/swap-transaction-parser.ts` (2.8K) → `parsers/unified-event-parser.ts`

**Actions:**
1. Integrate swap parsing into unified parser
2. Remove duplicate code
3. Update strategy imports

**Result**: 10 → 8 files in parsers/

### Phase 4: Utils Split (Improving Large Files)

#### 4.1 Raydium Strategy Split
**File to split:**
- `parsers/strategies/raydium-trade-strategy-simple.ts` (19K) → 3 files

**New files:**
1. `parsers/strategies/raydium/swap-detector.ts` - Detection logic only
2. `parsers/strategies/raydium/log-parser.ts` - Ray log parsing
3. `parsers/strategies/raydium/trade-builder.ts` - Trade event construction

**Actions:**
1. Extract detection logic (estimated 5K)
2. Extract log parsing logic (estimated 8K)
3. Extract trade building logic (estimated 6K)
4. Create index file for exports
5. Update imports

**Result**: More maintainable code, easier testing

## Implementation Schedule

### Week 1: High Priority Services
- Day 1-2: Pricing services consolidation
- Day 3: Metadata services consolidation
- Day 4-5: Token management consolidation
- Testing and verification

### Week 2: Medium Priority Services
- Day 1-2: AMM services consolidation
- Day 3: Recovery and monitoring consolidation
- Day 4-5: Core services consolidation
- Testing and verification

### Week 3: Utils Reorganization
- Day 1-2: AMM utils consolidation
- Day 3: Parser consolidation
- Day 4-5: Raydium strategy split
- Final testing and cleanup

## Testing Strategy

### Before Each Consolidation:
1. Run full test suite
2. Document current behavior
3. Create feature branch

### During Consolidation:
1. Maintain all public APIs
2. Add deprecation notices if needed
3. Update tests incrementally

### After Each Consolidation:
1. Run full test suite
2. Check for circular dependencies
3. Verify no performance regression
4. Update documentation

## Rollback Plan

Each phase can be rolled back independently:
1. Keep original files in `deprecated/` folder temporarily
2. Maintain git tags for each phase completion
3. Document any behavior changes
4. Keep import mappings for quick reversion

## Success Metrics

1. **File Count**: 59 → 43 files (-27%)
2. **Code Duplication**: Reduce by ~15%
3. **Import Complexity**: Reduce circular dependencies
4. **Build Time**: Maintain or improve
5. **Test Coverage**: Maintain at current level
6. **Bundle Size**: Reduce by ~10%

## Notes and Considerations

### Do NOT Consolidate:
- Analysis services (MEV, slippage, fork detection) - distinct domains
- Config files - clear separation needed
- Type definition files - widely imported
- Sanitizers - single-purpose utilities

### Naming Conventions:
- Use descriptive names that indicate combined functionality
- Maintain consistent naming patterns
- Add "unified" or "combined" prefix where appropriate

### Migration Path:
1. Create temporary aliases for smooth migration
2. Use deprecated exports with console warnings
3. Provide automated migration script
4. Update all documentation

## Post-Consolidation Structure

```
src/
├── services/ (~28 files)
│   ├── amm/ (2 files)
│   ├── analysis/ (3 files)
│   ├── core/ (6 files)
│   ├── metadata/ (3 files)
│   ├── monitoring/ (4 files)
│   ├── pricing/ (5 files)
│   ├── recovery/ (3 files)
│   └── token-management/ (4 files)
└── utils/ (~15 files)
    ├── amm/ (1 file)
    ├── config/ (2 files)
    ├── formatters/ (2 files)
    ├── parsers/ (9 files)
    │   └── strategies/ (6 files)
    │       └── raydium/ (3 files)
    └── sanitizers/ (1 file)
```

## Conclusion

This rebuild plan provides a systematic approach to consolidating the codebase while maintaining functionality and improving maintainability. The phased approach allows for incremental progress with minimal risk.