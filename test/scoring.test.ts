import { describe, it, expect } from 'vitest';
import { computeWeightedScore } from '@/lib/db/partners';

describe('computeWeightedScore (InvestorPilot weights)', () => {
  it('computes correct weighted average', () => {
    const score = computeWeightedScore({
      audience_overlap: 8,      // Advisor Reach
      complementarity: 6,       // Client Profile Fit
      partner_readiness: 7,     // Regulatory Standing
      reachability: 9,          // Geographic Relevance
      strategic_leverage: 5,    // Engagement Likelihood
    });
    // 8*0.3 + 6*0.25 + 7*0.15 + 9*0.15 + 5*0.15 = 2.4 + 1.5 + 1.05 + 1.35 + 0.75 = 7.05
    expect(score).toBe(7.05);
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

  it('weights advisor reach highest', () => {
    const highAdvisorReach = computeWeightedScore({
      audience_overlap: 10,
      complementarity: 1,
      partner_readiness: 1,
      reachability: 1,
      strategic_leverage: 1,
    });
    const highEngagement = computeWeightedScore({
      audience_overlap: 1,
      complementarity: 1,
      partner_readiness: 1,
      reachability: 1,
      strategic_leverage: 10,
    });
    expect(highAdvisorReach).toBeGreaterThan(highEngagement);
  });

  it('weights client profile fit second highest', () => {
    const highClientFit = computeWeightedScore({
      audience_overlap: 1,
      complementarity: 10,
      partner_readiness: 1,
      reachability: 1,
      strategic_leverage: 1,
    });
    const highRegulatory = computeWeightedScore({
      audience_overlap: 1,
      complementarity: 1,
      partner_readiness: 10,
      reachability: 1,
      strategic_leverage: 1,
    });
    expect(highClientFit).toBeGreaterThan(highRegulatory);
  });

  it('regulatory, geographic, and engagement have equal weight (0.15)', () => {
    const highRegulatory = computeWeightedScore({
      audience_overlap: 5,
      complementarity: 5,
      partner_readiness: 10,
      reachability: 1,
      strategic_leverage: 1,
    });
    const highGeographic = computeWeightedScore({
      audience_overlap: 5,
      complementarity: 5,
      partner_readiness: 1,
      reachability: 10,
      strategic_leverage: 1,
    });
    const highEngagement = computeWeightedScore({
      audience_overlap: 5,
      complementarity: 5,
      partner_readiness: 1,
      reachability: 1,
      strategic_leverage: 10,
    });
    expect(highRegulatory).toBe(highGeographic);
    expect(highGeographic).toBe(highEngagement);
  });

  it('weights sum to 1.0', () => {
    // All dimensions at different values to verify total
    const score = computeWeightedScore({
      audience_overlap: 10,
      complementarity: 10,
      partner_readiness: 10,
      reachability: 10,
      strategic_leverage: 10,
    });
    // 10*(0.3+0.25+0.15+0.15+0.15) = 10*1.0 = 10
    expect(score).toBe(10);
  });
});
