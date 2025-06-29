import { Router } from 'express';
import { Pool } from 'pg';

const router = Router();

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Get recent AMM trades
 */
router.get('/trades/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    
    const query = `
      SELECT 
        t.signature,
        t.mint_address,
        t.trade_type,
        t.user_address,
        t.sol_amount,
        t.token_amount,
        t.price_sol,
        t.price_usd,
        t.market_cap_usd,
        (t.sol_amount::numeric / 1e9 * 
         (SELECT price FROM sol_prices ORDER BY created_at DESC LIMIT 1)) as volume_usd,
        t.virtual_sol_reserves,
        t.virtual_token_reserves,
        t.slot,
        t.block_time,
        t.created_at,
        tk.symbol,
        tk.name,
        tk.image_uri
      FROM trades_unified t
      LEFT JOIN tokens_unified tk ON t.mint_address = tk.mint_address
      WHERE t.program = 'amm_pool'
      ORDER BY t.block_time DESC
      LIMIT $1
    `;
    
    const result = await pool.query(query, [limit]);
    
    // Format the response
    const trades = result.rows.map(row => ({
      signature: row.signature,
      mintAddress: row.mint_address,
      symbol: row.symbol || 'Unknown',
      name: row.name || 'Unknown Token',
      imageUri: row.image_uri,
      tradeType: row.trade_type,
      userAddress: row.user_address,
      solAmount: Number(row.sol_amount) / 1e9,
      tokenAmount: Number(row.token_amount) / 1e6,
      priceSol: parseFloat(row.price_sol),
      priceUsd: parseFloat(row.price_usd),
      marketCapUsd: parseFloat(row.market_cap_usd),
      volumeUsd: parseFloat(row.volume_usd),
      virtualSolReserves: row.virtual_sol_reserves,
      virtualTokenReserves: row.virtual_token_reserves,
      slot: row.slot,
      blockTime: row.block_time,
      createdAt: row.created_at
    }));
    
    res.json(trades);
    
  } catch (error) {
    console.error('Error fetching AMM trades:', error);
    res.status(500).json({ error: 'Failed to fetch AMM trades' });
  }
});

/**
 * Get AMM pools with current state
 */
router.get('/pools', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const orderBy = req.query.orderBy || 'liquidity';
    
    // Determine order column
    let orderColumn = 'latest_virtual_sol_reserves';
    switch (orderBy) {
      case 'volume':
        orderColumn = 'volume_24h';
        break;
      case 'trades':
        orderColumn = 'trades_24h';
        break;
      case 'created':
        orderColumn = 'first_seen_at';
        break;
    }
    
    const query = `
      WITH pool_stats AS (
        SELECT 
          mint_address,
          MAX(virtual_sol_reserves) as latest_virtual_sol_reserves,
          MAX(virtual_token_reserves) as latest_virtual_token_reserves,
          MAX(slot) as latest_slot,
          MAX(created_at) as last_update,
          COUNT(DISTINCT id) as state_updates
        FROM amm_pool_states
        WHERE created_at > NOW() - INTERVAL '1 hour'
        GROUP BY mint_address
      ),
      trade_stats AS (
        SELECT 
          mint_address,
          COUNT(*) as trades_24h,
          SUM(sol_amount::numeric / 1e9 * 
            (SELECT price FROM sol_prices ORDER BY created_at DESC LIMIT 1)) as volume_24h,
          COUNT(DISTINCT user_address) as unique_traders_24h,
          AVG(price_usd) as avg_price_24h
        FROM trades_unified
        WHERE program = 'amm_pool'
        AND block_time > NOW() - INTERVAL '24 hours'
        GROUP BY mint_address
      )
      SELECT 
        t.mint_address,
        t.symbol,
        t.name,
        t.image_uri,
        t.graduated_to_amm,
        t.first_seen_at,
        ps.latest_virtual_sol_reserves,
        ps.latest_virtual_token_reserves,
        ps.latest_slot,
        ps.last_update,
        ps.state_updates,
        ts.trades_24h,
        ts.volume_24h,
        ts.unique_traders_24h,
        ts.avg_price_24h,
        t.latest_price_usd,
        t.latest_market_cap_usd,
        -- Calculate current liquidity in USD
        (ps.latest_virtual_sol_reserves::numeric / 1e9 * 
         (SELECT price FROM sol_prices ORDER BY created_at DESC LIMIT 1)) as liquidity_usd
      FROM tokens_unified t
      INNER JOIN pool_stats ps ON t.mint_address = ps.mint_address
      LEFT JOIN trade_stats ts ON t.mint_address = ts.mint_address
      WHERE t.graduated_to_amm = true
      ORDER BY ${orderColumn} DESC NULLS LAST
      LIMIT $1
    `;
    
    const result = await pool.query(query, [limit]);
    
    // Format the response
    const pools = result.rows.map(row => ({
      mintAddress: row.mint_address,
      symbol: row.symbol || 'Unknown',
      name: row.name || 'Unknown Token',
      imageUri: row.image_uri,
      firstSeenAt: row.first_seen_at,
      reserves: {
        sol: row.latest_virtual_sol_reserves ? Number(row.latest_virtual_sol_reserves) / 1e9 : 0,
        token: row.latest_virtual_token_reserves ? Number(row.latest_virtual_token_reserves) / 1e6 : 0,
        lastUpdate: row.last_update,
        stateUpdates: row.state_updates
      },
      liquidity: {
        usd: parseFloat(row.liquidity_usd) || 0
      },
      stats24h: {
        trades: row.trades_24h || 0,
        volume: parseFloat(row.volume_24h) || 0,
        uniqueTraders: row.unique_traders_24h || 0,
        avgPrice: parseFloat(row.avg_price_24h) || 0
      },
      price: {
        current: parseFloat(row.latest_price_usd) || 0,
        marketCap: parseFloat(row.latest_market_cap_usd) || 0
      }
    }));
    
    res.json(pools);
    
  } catch (error) {
    console.error('Error fetching AMM pools:', error);
    res.status(500).json({ error: 'Failed to fetch AMM pools' });
  }
});

/**
 * Get AMM statistics
 */
router.get('/stats', async (_req, res) => {
  try {
    const query = `
      WITH amm_overview AS (
        SELECT 
          COUNT(DISTINCT t.mint_address) as total_amm_tokens,
          COUNT(DISTINCT CASE WHEN t.graduated_to_amm = true THEN t.mint_address END) as graduated_tokens,
          SUM(CASE WHEN t.graduated_to_amm = true THEN 1 ELSE 0 END) as active_pools
        FROM tokens_unified t
      ),
      trading_stats AS (
        SELECT 
          COUNT(*) as total_trades,
          COUNT(DISTINCT user_address) as unique_traders,
          SUM(sol_amount::numeric / 1e9 * 
              (SELECT price FROM sol_prices ORDER BY created_at DESC LIMIT 1)) as total_volume,
          AVG(price_usd) as avg_trade_price,
          SUM(CASE WHEN trade_type = 'buy' THEN 1 ELSE 0 END) as total_buys,
          SUM(CASE WHEN trade_type = 'sell' THEN 1 ELSE 0 END) as total_sells
        FROM trades_unified
        WHERE program = 'amm_pool'
        AND block_time > NOW() - INTERVAL '24 hours'
      ),
      liquidity_stats AS (
        SELECT 
          SUM(latest_virtual_sol_reserves::numeric / 1e9) as total_sol_locked,
          AVG(latest_virtual_sol_reserves::numeric / 1e9) as avg_sol_per_pool,
          MAX(latest_virtual_sol_reserves::numeric / 1e9) as max_sol_in_pool
        FROM (
          SELECT DISTINCT ON (mint_address)
            mint_address,
            virtual_sol_reserves as latest_virtual_sol_reserves
          FROM amm_pool_states
          ORDER BY mint_address, created_at DESC
        ) latest_states
      )
      SELECT 
        o.*,
        t.*,
        l.*,
        (SELECT price FROM sol_prices ORDER BY created_at DESC LIMIT 1) as sol_price
      FROM amm_overview o
      CROSS JOIN trading_stats t
      CROSS JOIN liquidity_stats l
    `;
    
    const result = await pool.query(query);
    const stats = result.rows[0];
    
    // Format the response
    const response = {
      overview: {
        totalAmmTokens: parseInt(stats.total_amm_tokens) || 0,
        graduatedTokens: parseInt(stats.graduated_tokens) || 0,
        activePools: parseInt(stats.active_pools) || 0
      },
      trading24h: {
        totalTrades: parseInt(stats.total_trades) || 0,
        uniqueTraders: parseInt(stats.unique_traders) || 0,
        totalVolume: parseFloat(stats.total_volume) || 0,
        avgTradePrice: parseFloat(stats.avg_trade_price) || 0,
        buyCount: parseInt(stats.total_buys) || 0,
        sellCount: parseInt(stats.total_sells) || 0,
        buySellRatio: parseInt(stats.total_sells) > 0 ? (parseInt(stats.total_buys) / parseInt(stats.total_sells)) : 0
      },
      liquidity: {
        totalSolLocked: parseFloat(stats.total_sol_locked) || 0,
        totalUsdLocked: (parseFloat(stats.total_sol_locked) || 0) * (parseFloat(stats.sol_price) || 180),
        avgSolPerPool: parseFloat(stats.avg_sol_per_pool) || 0,
        maxSolInPool: parseFloat(stats.max_sol_in_pool) || 0
      },
      solPrice: parseFloat(stats.sol_price) || 180
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Error fetching AMM stats:', error);
    res.status(500).json({ error: 'Failed to fetch AMM stats' });
  }
});

/**
 * Get specific pool details
 */
router.get('/pools/:mintAddress', async (req, res) => {
  try {
    const { mintAddress } = req.params;
    
    const query = `
      WITH pool_history AS (
        SELECT 
          id,
          pool_address,
          virtual_sol_reserves,
          virtual_token_reserves,
          real_sol_reserves,
          real_token_reserves,
          pool_open,
          slot,
          created_at,
          -- Calculate price from reserves
          CASE 
            WHEN virtual_token_reserves > 0 
            THEN (virtual_sol_reserves::numeric / virtual_token_reserves::numeric) * 1e3
            ELSE 0
          END as price_per_token
        FROM amm_pool_states
        WHERE mint_address = $1
        ORDER BY created_at DESC
        LIMIT 100
      ),
      recent_trades AS (
        SELECT 
          signature,
          trade_type,
          user_address,
          sol_amount,
          token_amount,
          price_usd,
          (sol_amount::numeric / 1e9 * 
           (SELECT price FROM sol_prices ORDER BY created_at DESC LIMIT 1)) as volume_usd,
          block_time
        FROM trades_unified
        WHERE mint_address = $1
        AND program = 'amm_pool'
        ORDER BY block_time DESC
        LIMIT 50
      )
      SELECT 
        json_build_object(
          'token', (
            SELECT json_build_object(
              'mintAddress', mint_address,
              'symbol', symbol,
              'name', name,
              'imageUri', image_uri,
              'graduatedToAmm', graduated_to_amm,
              'currentPrice', latest_price_usd,
              'marketCap', latest_market_cap_usd
            )
            FROM tokens_unified
            WHERE mint_address = $1
          ),
          'poolHistory', (
            SELECT json_agg(
              json_build_object(
                'id', id,
                'poolAddress', pool_address,
                'virtualSolReserves', virtual_sol_reserves::text,
                'virtualTokenReserves', virtual_token_reserves::text,
                'realSolReserves', real_sol_reserves::text,
                'realTokenReserves', real_token_reserves::text,
                'poolOpen', pool_open,
                'pricePerToken', price_per_token,
                'slot', slot,
                'createdAt', created_at
              )
            )
            FROM pool_history
          ),
          'recentTrades', (
            SELECT json_agg(
              json_build_object(
                'signature', signature,
                'tradeType', trade_type,
                'userAddress', user_address,
                'solAmount', sol_amount::numeric / 1e9,
                'tokenAmount', token_amount::numeric / 1e6,
                'priceUsd', price_usd,
                'volumeUsd', volume_usd,
                'blockTime', block_time
              )
            )
            FROM recent_trades
          )
        ) as data
    `;
    
    const result = await pool.query(query, [mintAddress]);
    
    if (result.rows.length === 0 || !result.rows[0].data.token) {
      return res.status(404).json({ error: 'Pool not found' });
    }
    
    return res.json(result.rows[0].data);
    
  } catch (error) {
    console.error('Error fetching pool details:', error);
    return res.status(500).json({ error: 'Failed to fetch pool details' });
  }
});

export default router;