import { describe, it, expect } from 'vitest';
import { computeWeightedScore } from '@/lib/db/partners';

/**
 * Lender-channel weights (v3, 2026-05-13) — per Senior Debt Brief v3 Section 4.
 *   audience_overlap (capital + ticket fit) = 25%
 *   complementarity (AU property dev debt focus) = 25%
 *   strategic_leverage (track record — strongest predictor) = 25%
 *   partner_readiness (decision authority + cadence) = 15%
 *   reachability (geography + LinkedIn visibility) = 10%
 *
 * Schema field names retained from v2 (advisor channel) — semantics
 * documented in src/lib/db/partners.ts and docs/sprint-0/09-f2k-best-fit-profile-DRAFT.md.
 */
describe('computeWeightedScore (lender ICP v3 weights)', () => {
  it('computes correct weighted average', () => {
    const score = computeWeightedScore({
      audience_overlap: 8,      // Capital + ticket fit
      complementarity: 6,       // AU property dev debt focus
      partner_readiness: 7,     // Decision authority + cadence
      reachability: 9,          // Geography + visibility
      strategic_leverage: 5,    // Track record
    });
    // 8*0.25 + 6*0.25 + 7*0.15 + 9*0.10 + 5*0.25 = 2.00 + 1.50 + 1.05 + 0.90 + 1.25 = 6.70
    expect(score).toBe(6.7);
  });

  it('handles all 10s', () => {
    const score = computeWeightedScore({
      audience_overlap: 10,
      complementarity: 10,
      partner_readiness: 10,
      reachability: 10,
      strategic_leverage: 10,
    });
    expect(score).toBe(10);
  });

  it('handles all 1s', () => {
    const score = computeWeightedScore({
      audience_overlap: 1,
      complementarity: 1,
      partner_readiness: 1,
      reachability: 1,
      strategic_leverage: 1,
    });
    expect(score).toBe(1);
  });

  it('capital fit, asset class focus, and track record share top weight (0.25)', () => {
    const highCapital = computeWeightedScore({
      audience_overlap: 10,
      complementarity: 1,
      partner_readiness: 1,
      reachability: 1,
      strategic_leverage: 1,
    });
    const highAssetClass = computeWeightedScore({
      audience_overlap: 1,
      complementarity: 10,
      partner_readiness: 1,
      reachability: 1,
      strategic_leverage: 1,
    });
    const highTrackRecord = computeWeightedScore({
      audience_overlap: 1,
      complementarity: 1,
      partner_readiness: 1,
      reachability: 1,
      strategic_leverage: 10,
    });
    expect(highCapital).toBe(highAssetClass);
    expect(highAssetClass).toBe(highTrackRecord);
  });

  it('decision authority is weighted higher than reachability', () => {
    const highAuthority = computeWeightedScore({
      audience_overlap: 5,
      complementarity: 5,
      partner_readiness: 10,
      reachability: 1,
      strategic_leverage: 5,
    });
    const highReachability = computeWeightedScore({
      audience_overlap: 5,
      complementarity: 5,
      partner_readiness: 1,
      reachability: 10,
      strategic_leverage: 5,
    });
    expect(highAuthority).toBeGreaterThan(highReachability);
  });

  it('top three (capital, asset class, track record) outweigh bottom two (authority, reachability)', () => {
    const highTopThree = computeWeightedScore({
      audience_overlap: 10,
      complementarity: 10,
      partner_readiness: 1,
      reachability: 1,
      strategic_leverage: 10,
    });
    const highBottomTwo = computeWeightedScore({
      audience_overlap: 1,
      complementarity: 1,
      partner_readiness: 10,
      reachability: 10,
      strategic_leverage: 1,
    });
    expect(highTopThree).toBeGreaterThan(highBottomTwo);
  });

  it('weights sum to 1.0', () => {
    // All dimensions at the same value to verify total
    const score = computeWeightedScore({
      audience_overlap: 10,
      complementarity: 10,
      partner_readiness: 10,
      reachability: 10,
      strategic_leverage: 10,
    });
    // 10*(0.25+0.25+0.25+0.15+0.10) = 10*1.0 = 10
    expect(score).toBe(10);
  });
});
