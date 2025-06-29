/**
 * GraphQL Queries for AMM Pool Data
 */

import { gql } from 'graphql-request';

/**
 * Query to fetch AMM pool states by token mints
 * Returns pool configuration for price calculation
 */
export const GET_AMM_POOLS = gql`
  query GetAmmPools($mints: [String!]!) {
    pump_fun_amm_Pool(
      where: {
        quote_mint: { _in: $mints }
      }
    ) {
      pubkey
      base_mint
      quote_mint
      pool_base_token_account
      pool_quote_token_account
      lp_supply
      _updatedAt
    }
  }
`;

/**
 * Query to fetch AMM pool reserves from token accounts
 * We need the actual token account balances to calculate prices
 */
export const GET_AMM_POOL_RESERVES = gql`
  query GetAmmPoolReserves($tokenAccounts: [String!]!) {
    spl_Account(
      where: {
        pubkey: { _in: $tokenAccounts }
      }
    ) {
      pubkey
      amount
      mint
      owner
      _updatedAt
    }
  }
`;

/**
 * Combined query to get pump.fun pools with token account data
 * Note: This requires separate queries as GraphQL doesn't support nested queries
 */
export const GET_AMM_POOLS_AND_ACCOUNTS = gql`
  query GetAmmPoolsAndAccounts($mints: [String!]!, $accounts: [String!]!) {
    pools: pump_fun_amm_Pool(
      where: {
        quote_mint: { _in: $mints }
      }
    ) {
      pubkey
      base_mint
      quote_mint
      pool_base_token_account
      pool_quote_token_account
      lp_supply
      _updatedAt
    }
    
    reserves: spl_Account(
      where: {
        pubkey: { _in: $accounts }
      }
    ) {
      pubkey
      amount
      mint
      owner
    }
  }
`;

/**
 * Query to find AMM pools for graduated tokens
 * Useful for mapping bonding curves to their AMM pools
 */
export const FIND_AMM_POOLS_BY_MINT = gql`
  query FindAmmPoolsByMint($mints: [String!]!) {
    pump_fun_amm_Pool(
      where: {
        quote_mint: { _in: $mints }
      }
      order_by: { _updatedAt: desc }
    ) {
      pubkey
      base_mint
      quote_mint
      pool_base_token_account
      pool_quote_token_account
      lp_supply
      _updatedAt
    }
  }
`;

/**
 * Query to check recent AMM pool updates
 * For monitoring recently graduated tokens
 */
export const GET_RECENT_AMM_POOLS = gql`
  query GetRecentAmmPools($since: timestamptz!, $limit: Int!) {
    pump_fun_amm_Pool(
      where: {
        _updatedAt: { _gte: $since }
      }
      order_by: { _updatedAt: desc }
      limit: $limit
    ) {
      pubkey
      base_mint
      quote_mint
      pool_base_token_account
      pool_quote_token_account
      lp_supply
      _updatedAt
    }
  }
`;