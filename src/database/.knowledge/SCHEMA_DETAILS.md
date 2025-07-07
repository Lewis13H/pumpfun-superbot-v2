# Detailed Schema Documentation

## Core Tables

### 1. tokens_unified
**Purpose**: Master token registry containing all token metadata, pricing, and state information.

**Key Characteristics**:
- Primary Key: `mint_address` (VARCHAR 64)
- 70+ columns tracking token lifecycle
- Automatic triggers for price updates
- Supports both BC and AMM tokens

**Column Groups**:

#### Identity & Metadata (15 columns)
```sql
mint_address        VARCHAR(64) PK   -- Token mint address
symbol              VARCHAR(32)      -- Token symbol
name                VARCHAR(128)     -- Token full name
uri                 VARCHAR(512)     -- Metadata URI
image_uri           VARCHAR(512)     -- Token image URL
description         TEXT             -- Token description
creator             VARCHAR(64)      -- Creator wallet address
decimals            INTEGER          -- Token decimals (usually 6)
total_supply        BIGINT           -- Total token supply
supply              NUMERIC(40,0)    -- Large number support
is_mutable          BOOLEAN          -- Can metadata change?
is_compressed       BOOLEAN          -- Compressed token?
compressed          BOOLEAN          -- Duplicate compression flag
token_standard      VARCHAR(50)      -- Token program standard
creators            JSONB            -- Creator array with shares
```

#### Authority Fields (4 columns)
```sql
mint_authority      VARCHAR(64)      -- Can mint more tokens?
freeze_authority    VARCHAR(64)      -- Can freeze accounts?
update_authority    VARCHAR(64)      -- Can update metadata?
```

#### Discovery & First Seen (7 columns)
```sql
first_seen_at       TIMESTAMPTZ      -- When first detected
first_seen_slot     BIGINT           -- Blockchain slot
first_program       VARCHAR(20)      -- 'bonding_curve' or 'amm_pool'
first_price_sol     DECIMAL(30,15)   -- Initial SOL price
first_price_usd     DECIMAL(30,15)   -- Initial USD price
first_market_cap_usd DECIMAL(30,15)  -- Initial market cap
block_time          TIMESTAMPTZ      -- First block time
```

#### Current State (12 columns)
```sql
current_program     VARCHAR(20)      -- Current trading venue
latest_price_sol    DECIMAL(20,12)   -- Current SOL price
latest_price_usd    DECIMAL(20,4)    -- Current USD price
current_price_sol   DECIMAL          -- Duplicate price field
current_price_usd   DECIMAL          -- Duplicate USD price
latest_market_cap_usd DECIMAL(20,4)  -- Current market cap
latest_update_slot  BIGINT           -- Last update slot
last_price_update   TIMESTAMPTZ      -- Last price update time
price_source        VARCHAR(50)      -- Price data source
liquidity_usd       DECIMAL(20,4)    -- Total liquidity value
price_change_1h     DECIMAL          -- 1 hour price change %
price_change_24h    DECIMAL          -- 24 hour price change %
```

#### Bonding Curve State (6 columns)
```sql
bonding_curve_key   VARCHAR(100)     -- BC address
latest_virtual_sol_reserves BIGINT   -- Virtual SOL in BC
latest_virtual_token_reserves BIGINT -- Virtual tokens in BC
latest_bonding_curve_progress DECIMAL(5,2) -- Progress to graduation
bonding_curve_complete BOOLEAN       -- Graduation complete flag
```

#### Graduation & Thresholds (8 columns)
```sql
graduated_to_amm    BOOLEAN          -- Has graduated to AMM?
graduation_at       TIMESTAMPTZ      -- When graduated
graduation_slot     BIGINT           -- Graduation blockchain slot
threshold_crossed_at TIMESTAMPTZ     -- When crossed $8,888
threshold_price_sol DECIMAL(20,12)   -- Price at threshold
threshold_price_usd DECIMAL(20,4)    -- USD price at threshold
threshold_market_cap_usd DECIMAL(20,4) -- Market cap at threshold
threshold_slot      BIGINT           -- Slot at threshold
```

#### Trading Statistics (6 columns)
```sql
total_trades        INTEGER          -- Total trade count
total_buys          INTEGER          -- Total buy trades
total_sells         INTEGER          -- Total sell trades
volume_24h_sol      DECIMAL(20,9)    -- 24h SOL volume
volume_24h_usd      DECIMAL(20,4)    -- 24h USD volume
unique_traders_24h  INTEGER          -- Unique traders in 24h
```

#### Enrichment & Social (11 columns)
```sql
metadata_enriched   BOOLEAN          -- Has enrichment run?
metadata_enriched_at TIMESTAMPTZ     -- When enriched
metadata_source     VARCHAR(50)      -- Enrichment source
metadata_updated_at TIMESTAMPTZ      -- Last metadata update
metadata_last_updated TIMESTAMPTZ    -- Duplicate update field
enrichment_attempts INTEGER          -- Enrichment retry count
is_enriched         BOOLEAN          -- Enrichment success flag
helius_metadata     JSONB            -- Raw Helius response
twitter             VARCHAR(255)     -- Twitter handle
telegram            VARCHAR(255)     -- Telegram link
discord             VARCHAR(255)     -- Discord server
website             VARCHAR(255)     -- Project website
metadata_score      INTEGER          -- Quality score (0-100)
```

#### Stale Detection (5 columns)
```sql
last_trade_at       TIMESTAMPTZ      -- Last trade timestamp
is_stale            BOOLEAN          -- Price data stale?
stale_marked_at     TIMESTAMPTZ      -- When marked stale
should_remove       BOOLEAN          -- Should auto-remove?
```

#### Recovery & Updates (6 columns)
```sql
last_graphql_update TIMESTAMPTZ      -- GraphQL update time
last_rpc_update     TIMESTAMPTZ      -- RPC update time
last_dexscreener_update TIMESTAMP    -- DexScreener update
recovery_attempts   INTEGER          -- Recovery attempt count
last_recovery_attempt TIMESTAMPTZ    -- Last recovery time
```

#### System Fields (7 columns)
```sql
holder_count        INTEGER          -- Token holder count
top_holder_percentage DECIMAL(5,2)   -- Top holder ownership %
monitoring_tier     INTEGER          -- Priority tier (1-5)
creation_slot       BIGINT           -- Token creation slot
token_created_at    TIMESTAMPTZ      -- Token creation time
created_at          TIMESTAMPTZ      -- DB record created
updated_at          TIMESTAMPTZ      -- DB record updated
last_seen_at        TIMESTAMPTZ      -- Last activity seen
```

### 2. trades_unified
**Purpose**: Stores all trading activity for both bonding curves and AMM pools.

**Key Characteristics**:
- Primary Key: `id` (BIGSERIAL)
- Unique Key: `signature` (transaction hash)
- Triggers update token prices
- Supports BC and AMM trades

**Columns**:
```sql
id                  BIGSERIAL PK     -- Auto-increment ID
signature           VARCHAR(128) UQ  -- Transaction signature
mint_address        VARCHAR(64)      -- Token traded
program             VARCHAR(20)      -- 'bonding_curve' or 'amm_pool'
trade_type          VARCHAR(10)      -- 'buy' or 'sell'
user_address        VARCHAR(64)      -- Trader wallet
sol_amount          BIGINT           -- SOL amount (lamports)
token_amount        BIGINT           -- Token amount
price_sol           DECIMAL(20,12)   -- Token price in SOL
price_usd           DECIMAL(20,12)   -- Token price in USD
market_cap_usd      DECIMAL(20,4)    -- Market cap at trade
volume_usd          DECIMAL(30,15)   -- Trade volume USD
virtual_sol_reserves BIGINT          -- Virtual SOL (BC only)
virtual_token_reserves BIGINT        -- Virtual tokens (BC only)
bonding_curve_key   VARCHAR(100)     -- BC address (BC only)
bonding_curve_progress DECIMAL(5,2)  -- Progress % (BC only)
slot                BIGINT           -- Blockchain slot
block_time          TIMESTAMPTZ      -- Transaction time
timestamp           TIMESTAMPTZ      -- Duplicate time field
created_at          TIMESTAMPTZ      -- Record creation
```

## AMM Enhancement Tables

### 3. amm_pool_state
**Purpose**: Current state of AMM pools (one record per pool).

```sql
pool_address        VARCHAR(64) PK   -- Pool address
mint_address        VARCHAR(64)      -- Token mint
virtual_sol_reserves BIGINT          -- Virtual SOL reserves
virtual_token_reserves BIGINT        -- Virtual token reserves
virtual_lp_supply   BIGINT           -- LP token supply
swap_fee_numerator  BIGINT           -- Fee numerator
swap_fee_denominator BIGINT          -- Fee denominator
total_volume_sol    BIGINT           -- Total volume
total_trades        INTEGER          -- Trade count
last_price_sol      DECIMAL          -- Latest price
last_price_usd      DECIMAL          -- Latest USD price
last_update_slot    BIGINT           -- Update slot
last_update_time    TIMESTAMPTZ      -- Update time
created_at          TIMESTAMPTZ      -- Record created
updated_at          TIMESTAMPTZ      -- Record updated
```

### 4. liquidity_events
**Purpose**: Tracks all liquidity add/remove events.

```sql
id                  SERIAL PK        -- Auto ID
pool_address        VARCHAR(64)      -- Pool address
event_type          VARCHAR(20)      -- 'add' or 'remove'
user_address        VARCHAR(64)      -- User wallet
sol_amount          BIGINT           -- SOL amount
token_amount        BIGINT           -- Token amount
lp_tokens_minted    BIGINT           -- LP minted (add)
lp_tokens_burned    BIGINT           -- LP burned (remove)
lp_amount           BIGINT           -- LP token amount
base_amount         BIGINT           -- Base amount
quote_amount        BIGINT           -- Quote amount
base_price_usd      DECIMAL          -- Base price USD
quote_price_usd     DECIMAL          -- Quote price USD
total_value_usd     DECIMAL          -- Total value
impermanent_loss    DECIMAL          -- IL percentage
pool_sol_balance    BIGINT           -- Pool SOL after
pool_token_balance  BIGINT           -- Pool tokens after
slot                BIGINT           -- Transaction slot
signature           VARCHAR(88)      -- TX signature
block_time          TIMESTAMPTZ      -- Block time
created_at          TIMESTAMPTZ      -- Record created
```

### 5. amm_fee_events
**Purpose**: Tracks trading fees collected.

```sql
id                  SERIAL PK        -- Auto ID
pool_address        VARCHAR(64)      -- Pool address
trade_signature     VARCHAR(88)      -- Trade TX
fee_sol_amount      BIGINT           -- SOL fee
fee_token_amount    BIGINT           -- Token fee
fee_percentage      DECIMAL          -- Fee %
cumulative_fees_sol BIGINT           -- Total SOL fees
cumulative_fees_token BIGINT         -- Total token fees
event_type          VARCHAR(30)      -- Event type
recipient           VARCHAR(64)      -- Fee recipient
coin_amount         BIGINT           -- Coin amount
pc_amount           BIGINT           -- PC amount
coin_value_usd      DECIMAL          -- Coin value USD
pc_value_usd        DECIMAL          -- PC value USD
total_value_usd     DECIMAL          -- Total value USD
slot                BIGINT           -- Transaction slot
signature           VARCHAR(88)      -- TX signature
block_time          TIMESTAMPTZ      -- Block time
created_at          TIMESTAMPTZ      -- Record created
```

## Monitoring & Recovery Tables

### 6. recovery_progress
**Purpose**: Tracks historical data recovery operations.

```sql
id                  SERIAL PK        -- Auto ID
period_start        TIMESTAMP        -- Recovery start
period_end          TIMESTAMP        -- Recovery end
tokens_processed    INTEGER          -- Tokens processed
tokens_total        INTEGER          -- Total to process
trades_recovered    INTEGER          -- Trades recovered
status              VARCHAR(20)      -- Status
started_at          TIMESTAMP        -- Job start
completed_at        TIMESTAMP        -- Job complete
error_message       TEXT             -- Error details
recovery_source     VARCHAR(50)      -- Data source
created_at          TIMESTAMP        -- Record created
```

### 7. stale_detection_runs
**Purpose**: Audit log for stale token detection.

```sql
id                  SERIAL PK        -- Auto ID
run_at              TIMESTAMPTZ      -- Run timestamp
tokens_checked      INTEGER          -- Tokens checked
tokens_marked_stale INTEGER          -- Marked stale
tokens_marked_removal INTEGER        -- Marked removal
tokens_recovered    INTEGER          -- Recovered
execution_time_ms   INTEGER          -- Runtime ms
status              VARCHAR(20)      -- Status
error_message       TEXT             -- Error details
```

## Key Indexes

### Performance Critical
```sql
-- Market cap sorting (most used)
CREATE INDEX idx_tokens_market_cap ON tokens_unified(latest_market_cap_usd DESC)
WHERE latest_market_cap_usd IS NOT NULL;

-- Time-based trade queries
CREATE INDEX idx_trades_block_time ON trades_unified(block_time DESC);

-- Graduated token filtering
CREATE INDEX idx_tokens_graduated ON tokens_unified(graduated_to_amm)
WHERE graduated_to_amm = true;

-- Composite for common queries
CREATE INDEX idx_trades_unified_composite 
ON trades_unified(mint_address, block_time DESC);
```

### Monitoring & Maintenance
```sql
-- Stale detection
CREATE INDEX idx_tokens_stale ON tokens_unified(is_stale, last_trade_at)
WHERE is_stale = true;

-- Removal candidates
CREATE INDEX idx_tokens_removal ON tokens_unified(should_remove)
WHERE should_remove = true;

-- Enrichment tracking
CREATE INDEX idx_tokens_enrichment ON tokens_unified(metadata_enriched, metadata_enriched_at)
WHERE metadata_enriched = false;
```

## Triggers

### 1. trigger_update_token_latest_prices
**On**: trades_unified INSERT
**Action**: Updates token prices and statistics
```sql
-- Updates on new trade:
- latest_price_sol/usd
- latest_market_cap_usd
- total_trades/buys/sells
- last_trade_at
- is_stale = false
```

### 2. ensure_token_exists
**On**: trades_unified BEFORE INSERT
**Action**: Creates token if not exists
```sql
-- Prevents orphaned trades
-- Creates placeholder token entry
-- Maintains referential integrity
```