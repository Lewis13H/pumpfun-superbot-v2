/**
 * GraphQL Queries for Bonding Curve Data
 */

import { gql } from 'graphql-request';

/**
 * Query to fetch multiple bonding curves by token mints
 * Returns current reserve states for price calculation
 */
export const GET_BONDING_CURVES = gql`
  query GetBondingCurves($pubkeys: [String!]!) {
    pump_BondingCurve(
      where: {
        pubkey: { _in: $pubkeys }
        complete: { _eq: false }
      }
    ) {
      pubkey
      virtualSolReserves
      virtualTokenReserves
      realSolReserves
      realTokenReserves
      tokenTotalSupply
      complete
      _updatedAt
    }
  }
`;

/**
 * Query to fetch bonding curves updated after a specific time
 * Useful for catching missed updates during downtime
 */
export const GET_UPDATED_BONDING_CURVES = gql`
  query GetUpdatedBondingCurves($since: timestamptz!, $limit: Int!) {
    pump_BondingCurve(
      where: {
        _updatedAt: { _gte: $since }
        complete: { _eq: false }
      }
      order_by: { _updatedAt: desc }
      limit: $limit
    ) {
      pubkey
      tokenMint
      virtualSolReserves
      virtualTokenReserves
      realSolReserves
      realTokenReserves
      tokenTotalSupply
      complete
      _updatedAt
    }
  }
`;

/**
 * Query to check if bonding curves exist for given mints
 * Useful for validating tokens before detailed queries
 */
export const CHECK_BONDING_CURVES_EXIST = gql`
  query CheckBondingCurvesExist($pubkeys: [String!]!) {
    pump_BondingCurve(
      where: {
        pubkey: { _in: $pubkeys }
      }
    ) {
      pubkey
      complete
    }
  }
`;

/**
 * Query to fetch graduated (completed) bonding curves
 * For tracking tokens that have moved to AMM
 */
export const GET_GRADUATED_CURVES = gql`
  query GetGraduatedCurves($pubkeys: [String!]!) {
    pump_BondingCurve(
      where: {
        pubkey: { _in: $pubkeys }
        complete: { _eq: true }
      }
    ) {
      pubkey
      complete
      virtualSolReserves
      virtualTokenReserves
      _updatedAt
    }
  }
`;