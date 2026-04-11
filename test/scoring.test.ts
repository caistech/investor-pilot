import { describe, it, expect } from 'vitest';
import { computeWeightedScore } from '@/lib/db/partners';

describe('computeWeightedScore', () => {
  it('computes correct weighted average', () => {
    const score = computeWeightedScore({
      audience_overlap: 8,
      complementarity: 6,
      partner_readiness: 7,
      reachability: 9,
      strategic_leverage: 5,
    });
    // 8*0.3 + 6*0.25 + 7*0.2 + 9*0.15 + 5*0.1 = 2.4 + 1.5 + 1.4 + 1.35 + 0.5 = 7.15
    expect(score).toBe(7.15);
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

  it('weights overlap highest and leverage lowest', () => {
    const highOverlap = computeWeightedScore({
      audience_overlap: 10,
      complementarity: 1,
      partner_readiness: 1,
      reachability: 1,
      strategic_leverage: 1,
    });
    const highLeverage = computeWeightedScore({
      audience_overlap: 1,
      complementarity: 1,
      partner_readiness: 1,
      reachability: 1,
      strategic_leverage: 10,
    });
    expect(highOverlap).toBeGreaterThan(highLeverage);
  });
});
