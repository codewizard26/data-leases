import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { AnswerEnvelopeSchema, NegotiationMessageSchema, VerificationRequestSchema, VerificationResultSchema } from '../src/index.js';
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}
test('canonical offers and answer fixtures validate without inventing evidence', () => {
  for (const name of ['offer.low-price.json', 'offer.countered.json', 'offer.rejected.json']) expect(NegotiationMessageSchema.safeParse(fixture(name)).success).toBe(true);
  for (const name of ['answer.valid.json', 'answer.tampered.json']) expect(AnswerEnvelopeSchema.safeParse(fixture(name)).success).toBe(true);
  expect(VerificationRequestSchema.safeParse(fixture('verification-request-valid.json')).success).toBe(true);
});
test('verification fixtures preserve MOCK mode across all outcomes', () => {
  for (const status of ['accepted', 'rejected', 'inconclusive']) {
    const result = VerificationResultSchema.parse(fixture(`verification.${status}.json`));
    expect(result.executionMode).toBe('MOCK');
    expect(result.status).toBe(status.toUpperCase());
    expect(VerificationResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
  }
});
