# Git Worktree Setup for Parallel Development

## Current Setup

You now have two worktrees set up for parallel development:

1. **Main Worktree** (Current Terminal)
   - Path: `/Users/lewisharding/Coding Projects/pumpfun-superbot-v2-mac/pumpfun-superbot-v2`
   - Branch: `feature/bc-monitor`
   - Purpose: Continue working on bonding curve features

2. **AMM Enhancement Worktree** (New Terminal)
   - Path: `/Users/lewisharding/Coding Projects/pumpfun-superbot-v2-mac/pumpfun-amm-enhancement`
   - Branch: `feature/amm-enhancements`
   - Purpose: Develop AMM enhancement features

## How to Use

### Terminal 1 (Current - BC Features)
```bash
# You're already here
# Continue working on BC monitor features
npm run dev
```

### Terminal 2 (New - AMM Features)
```bash
# Open a new terminal
cd /Users/lewisharding/Coding Projects/pumpfun-superbot-v2-mac/pumpfun-amm-enhancement

# Install dependencies (shared node_modules won't be copied)
npm install

# Start development
npm run dev

# Work on AMM enhancements
claude code
```

## Benefits of This Setup

1. **Parallel Development**: Work on different features simultaneously
2. **No Branch Switching**: Each worktree has its own branch
3. **Isolated Changes**: Changes in one worktree don't affect the other
4. **Shared Repository**: Both worktrees share the same git history

## Common Commands

### List all worktrees
```bash
git worktree list
```

### Remove a worktree (when done)
```bash
# First, delete the worktree directory
rm -rf ../pumpfun-amm-enhancement

# Then remove from git
git worktree prune
```

### Push changes from AMM worktree
```bash
# In the AMM worktree directory
git add .
git commit -m "feat: AMM enhancement implementation"
git push -u origin feature/amm-enhancements
```

## Workflow

1. **Main worktree**: Continue BC monitor development
2. **AMM worktree**: Implement AMM enhancements per strategy
3. **Both can run simultaneously**: Different ports for API/dashboard
4. **Merge when ready**: Create PRs from both branches

## Important Notes

- Each worktree needs its own `node_modules` (run `npm install`)
- Environment variables (.env) need to be copied to each worktree
- Database migrations affect both worktrees (same DB)
- Use different API ports if running both simultaneously:
  ```bash
  # Terminal 1
  API_PORT=3001 npm run dev
  
  # Terminal 2
  API_PORT=3002 npm run dev
  ```

## Next Steps

1. Open new terminal for AMM development
2. Navigate to AMM worktree
3. Copy `.env` file: `cp ../pumpfun-superbot-v2/.env .`
4. Run `npm install`
5. Start implementing AMM enhancements per the strategy document