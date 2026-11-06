import { expect, test } from 'vitest';
import * as contracts from '../src/index.js';
test('minor units reject floating point and negative values', () => {
  expect(contracts.MinorUnitsSchema.safeParse('1.5').success).toBe(false);
  expect(contracts.MinorUnitsSchema.safeParse('-1').success).toBe(false);
  expect(contracts.MinorUnitsSchema.parse('9007199254740993123')).toBe('9007199254740993123');
});
const answer = { schemaVersion: '1.0.0', sessionId: 'session-1', negotiationId: 'negotiation-1', runId: 'run-1', questionTemplateId: 'ETHEREUM_LENDING_LIQUIDITY', providerId: 'provider-a', acceptedQuoteId: 'quote-1', deliveredAt: '2026-11-06T12:00:00Z', chainId: 'eip155:1', metric: 'demo.liquidity', value: '1000000', unit: 'raw', methodologyVersion: 'demo-v1', evidenceRefs: [], evidencePolicyId: 'demo-v1', demoTrustMode: 'UNTRUSTED_MOCK' };
const request = { schemaVersion: '1.0.0', verificationId: 'verification-1', runId: 'run-1', sessionId: 'session-1', questionTemplateId: 'ETHEREUM_LENDING_LIQUIDITY', providerId: 'provider-a', answer, policy: { policyId: 'demo-v1', version: '1', allowedChainIds: ['eip155:1'], allowedMetricIds: ['demo.liquidity'], maxAgeSeconds: 60 }, requestedAt: '2026-11-06T12:00:01Z' };
test('verification rejects mismatched end-to-end correlation', () => {
  expect(contracts.VerificationRequestSchema.safeParse(request).success).toBe(true);
  for (const field of ['runId', 'sessionId', 'providerId', 'questionTemplateId']) {
    expect(contracts.VerificationRequestSchema.safeParse({ ...request, [field]: 'other' }).success).toBe(false);
  }
});
test('direct discovery requires a card URL', () => {
  expect(contracts.DiscoveryQuerySchema.safeParse({ schemaVersion: '1.0.0', sessionId: 's', mode: 'DIRECT_URL', questionTemplateId: 'q', maxPriceMinor: '1', currency: 'demo:USD6', maxAgeSeconds: 60, requestedAt: '2026-11-06T12:00:00Z' }).success).toBe(false);
});
test('answers require exact numeric values and signed mode needs signature', () => {
  expect(contracts.AnswerEnvelopeSchema.safeParse({ ...answer, value: 'trust me' }).success).toBe(false);
  expect(contracts.AnswerEnvelopeSchema.safeParse({ ...answer, demoTrustMode: 'SIGNED_PROVIDER' }).success).toBe(false);
});
test('accepted verification cannot hide failed or missing checks', () => {
  const result = { schemaVersion: '1.0.0', verificationId: 'v', runId: 'r', providerId: 'p', executionMode: 'MOCK', status: 'ACCEPTED', executedAt: '2026-11-06T12:00:00Z', evidenceRefs: [], checks: [] };
  expect(contracts.VerificationResultSchema.safeParse(result).success).toBe(false);
  expect(contracts.VerificationResultSchema.safeParse({ ...result, checks: [{ checkId: 'test', status: 'FAIL', reasonCode: 'MISMATCH' }] }).success).toBe(false);
});
