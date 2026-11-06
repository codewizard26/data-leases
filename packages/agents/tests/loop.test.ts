import { describe, expect, test } from 'vitest';
import * as agents from '../src/index.js';
describe('buyer/provider A2A loop', () => {
 test('negotiates a counteroffer over real HTTP and never exceeds budget', async () => {
  expect(agents.startProvider).toBeTypeOf('function');
  const provider = await agents.startProvider({ port: 0, providerId: 'provider-a', askMinor: '500', floorMinor: '300' });
  try {
   const result = await agents.negotiate({ baseUrl: provider.baseUrl, providerId: 'provider-a', maxPriceMinor: '350' });
   expect(result.status).toBe('AGREED');
   expect(result.priceMinor).toBe('350');
   expect(result.transcript.map(turn => turn.action)).toEqual(['REQUEST_FOR_QUOTE','PROPOSE','COUNTER','PROPOSE','ACCEPT','ACCEPT']);
   expect(result.transcript.every(turn => turn.runId === result.runId)).toBe(true);
  } finally { await provider.close(); }
 });
 test('rejects a seller floor above budget', async () => {
  const provider = await agents.startProvider({ port: 0, providerId: 'provider-b', askMinor: '500', floorMinor: '400' });
  try { expect((await agents.negotiate({ baseUrl: provider.baseUrl, providerId: 'provider-b', maxPriceMinor: '350' })).status).toBe('REJECTED'); }
  finally { await provider.close(); }
 });
});
test('expired buyer policy sends no negotiation messages', async () => {
 const provider = await agents.startProvider({ port: 0, providerId: 'expired', askMinor: '100', floorMinor: '50' });
 try {
  const result = await agents.negotiate({ baseUrl: provider.baseUrl, providerId: 'expired', maxPriceMinor: '100', deadlineAt: '2020-01-01T00:00:00Z' });
  expect(result.status).toBe('EXPIRED');
  expect(result.transcript).toEqual([]);
 } finally { await provider.close(); }
});
test('buyer rejects nonlocal destinations before fetching', async () => {
 await expect(agents.negotiate({ baseUrl: 'https://example.com', providerId: 'external', maxPriceMinor: '1' })).rejects.toThrow('ONLY_EXPLICIT_LOCAL_PROVIDER_SUPPORTED');
});
test('preserves integer prices beyond JavaScript safe integer range', async () => {
 const provider = await agents.startProvider({ port: 0, providerId: 'large', askMinor: '9007199254740993999', floorMinor: '9007199254740993000' });
 try {
  const result = await agents.negotiate({ baseUrl: provider.baseUrl, providerId: 'large', maxPriceMinor: '9007199254740993123' });
  expect(result.status).toBe('AGREED');
  expect(result.priceMinor).toBe('9007199254740993123');
 } finally { await provider.close(); }
});
test('occupied provider port rejects with EADDRINUSE rather than address TypeError', async () => {
 const provider = await agents.startProvider({ port: 0, providerId: 'occupied', askMinor: '100', floorMinor: '50' });
 try {
  const port = Number(new URL(provider.baseUrl).port);
  await expect(agents.startProvider({ port, providerId: 'conflict', askMinor: '100', floorMinor: '50' })).rejects.toMatchObject({ code: 'EADDRINUSE' });
 } finally { await provider.close(); }
});
