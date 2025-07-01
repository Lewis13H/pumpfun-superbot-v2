/**
 * GraphQL Queries for Pump.fun Specific Data
 * Extends existing queries to capture creator, supply, and bonding curve information
 */

import { gql } from 'graphql-request';

/**
 * Query to fetch bonding curve data including creator and token supply
 * This provides pump.fun specific data not available in standard metadata
 */
export const GET_PUMP_FUN_BONDING_CURVE_DATA = gql`
  query GetPumpFunBondingCurveData($pubkeys: [String!]!) {
    pump_BondingCurve(
      where: { pubkey: { _in: $pubkeys } }
    ) {
      pubkey
      virtualTokenReserves
      virtualSolReserves
      realTokenReserves
      realSolReserves
      tokenTotalSupply
      complete
      _updatedAt
    }
  }
`;

/**
 * Query to analyze creator history for risk assessment
 * Fetches all tokens created by specific addresses
 */
export const GET_PUMP_FUN_CREATOR_ANALYSIS = gql`
  query GetPumpFunCreatorAnalysis($creators: [String!]!) {
    pump_BondingCurve(
      where: { creator: { _in: $creators } }
      order_by: { _createdAt: desc }
    ) {
      creator
      tokenMint
      complete
      virtualSolReserves
      tokenTotalSupply
      _createdAt
      _updatedAt
    }
  }
`;

/**
 * Query to get recent pump.fun token creations
 * Useful for discovering new tokens that need enrichment
 */
export const GET_RECENT_PUMP_FUN_TOKENS = gql`
  query GetRecentPumpFunTokens($since: timestamptz!, $limit: Int!) {
    pump_BondingCurve(
      where: { _createdAt: { _gte: $since } }
      order_by: { _createdAt: desc }
      limit: $limit
    ) {
      tokenMint
      creator
      virtualTokenReserves
      virtualSolReserves
      tokenTotalSupply
      complete
      _createdAt
    }
  }
`;

/**
 * Query to check bonding curve completion status
 * Helps identify tokens that have graduated or are close to graduation
 */
export const GET_BONDING_CURVE_STATUS = gql`
  query GetBondingCurveStatus($mints: [String!]!) {
    pump_BondingCurve(
      where: { tokenMint: { _in: $mints } }
    ) {
      tokenMint
      complete
      virtualSolReserves
      virtualTokenReserves
      _updatedAt
    }
  }
`;

/**
 * Query to get token metadata with bonding curve data in one request
 * Combines Metaplex metadata with pump.fun specific data
 */
export const GET_PUMP_FUN_ENRICHED_DATA = gql`
  query GetPumpFunEnrichedData($mints: [String!]!) {
    # Get token supply data
    tokens: spl_Token(
      where: { pubkey: { _in: $mints } }
    ) {
      pubkey
      decimals
      supply
      mint_authority
      freeze_authority
    }
  }
`;