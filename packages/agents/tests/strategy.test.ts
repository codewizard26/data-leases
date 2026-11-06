import { expect, test } from 'vitest';
import { AiNegotiationStrategy } from '../src/strategy.js';
import type { ComputeAdapter, ComputeInput, ComputeOutput } from '../src/compute.js';
function adapter(value: unknown, provider: ComputeOutput['provider'] = 'OPENROUTER'): ComputeAdapter {
 return { async generate() { return { provider, model: 'test-model:free', text: JSON.stringify(value) }; } };
}
const buyer = { quoteMinor: '500', capMinor: '350', round: 1 };
const seller = { kind: 'counter' as const, askMinor: '500', floorMinor: '300', incomingPriceMinor: '350', round: 2 };
test('AI buyer counter is derived from model JSON and stays under integer cap', async () => {
 const result = await new AiNegotiationStrategy(adapter({ action: 'COUNTER', priceMinor: '325', reason: 'Offer fits budget.' })).buyer(buyer);
 expect(result).toEqual({ action: 'COUNTER', priceMinor: '325', reason: 'Offer fits budget.', provider: 'OPENROUTER', model: 'test-model:free' });
});
test('AI buyer accepts only exact quote inside cap', async () => {
 const strategy = new AiNegotiationStrategy(adapter({ action: 'ACCEPT', priceMinor: '350', reason: 'Within budget.' }));
 expect((await strategy.buyer({ ...buyer, quoteMinor: '350' })).action).toBe('ACCEPT');
 await expect(strategy.buyer(buyer)).rejects.toThrow('AI_INVALID_DECISION');
});
for (const decision of [
 { action: 'ACCEPT', priceMinor: '500', reason: 'Over cap.' },
 { action: 'COUNTER', priceMinor: '351', reason: 'Over cap.' },
 { action: 'COUNTER', priceMinor: '500', reason: 'No reduction.' },
 { action: 'COUNTER', priceMinor: '-1', reason: 'Invalid amount.' },
 { action: 'COUNTER', priceMinor: '1.5', reason: 'Fractional.' },
 { action: 'COUNTER', priceMinor: '300', reason: 'Extra field.', url: 'https://evil.example' },
 { action: 'REJECT', priceMinor: '100', reason: 'Rejected terms.' },
 { action: 'REJECT', reason: 'x'.repeat(501) },
]) test(`rejects unsafe buyer output ${JSON.stringify(decision).slice(0, 90)}`, async () => {
 await expect(new AiNegotiationStrategy(adapter(decision)).buyer(buyer)).rejects.toThrow('AI_INVALID_DECISION');
});
test('seller may propose only between floor and asking ceiling', async () => {
 expect((await new AiNegotiationStrategy(adapter({ action: 'PROPOSE', priceMinor: '375', reason: 'Meet near middle.' })).seller(seller)).priceMinor).toBe('375');
 for (const priceMinor of ['299', '501']) await expect(new AiNegotiationStrategy(adapter({ action: 'PROPOSE', priceMinor, reason: 'Unsafe offer.' })).seller(seller)).rejects.toThrow('AI_INVALID_DECISION');
});
test('model may explicitly reject without a price', async () => {
 expect((await new AiNegotiationStrategy(adapter({ action: 'REJECT', reason: 'Cannot agree.' })).seller(seller)).action).toBe('REJECT');
});
test('integer money beyond JavaScript safe range remains exact', async () => {
 const priceMinor = '9007199254740993123';
 const result = await new AiNegotiationStrategy(adapter({ action: 'COUNTER', priceMinor, reason: 'Exact minor units.' })).buyer({ quoteMinor: '9007199254740993999', capMinor: priceMinor, round: 2 });
 expect(result.priceMinor).toBe(priceMinor);
});
test('invalid bounds and rounds fail before calling compute', async () => {
 let calls = 0;
 const strategy = new AiNegotiationStrategy({ async generate() { calls++; throw new Error('not called'); } });
 for (const round of [0, 4, 1.5]) await expect(strategy.buyer({ ...buyer, round })).rejects.toThrow('AI_INVALID_DECISION');
 await expect(strategy.seller({ ...seller, floorMinor: '501' })).rejects.toThrow('AI_INVALID_DECISION');
 await expect(strategy.seller({ ...seller, incomingPriceMinor: undefined })).rejects.toThrow('AI_INVALID_DECISION');
 expect(calls).toBe(0);
});
test('mock, malformed JSON and upstream failure never silently fall back', async () => {
 await expect(new AiNegotiationStrategy(adapter({ action: 'REJECT', reason: 'mock' }, 'MOCK')).buyer(buyer)).rejects.toThrow('AI_INVALID_DECISION');
 await expect(new AiNegotiationStrategy({ async generate() { return { provider: 'OPENROUTER', model: 'test', text: '```json\n{}\n```' }; } }).buyer(buyer)).rejects.toThrow('AI_INVALID_DECISION');
 await expect(new AiNegotiationStrategy({ async generate() { throw new Error('COMPUTE_HTTP_429'); } }).buyer(buyer)).rejects.toThrow('COMPUTE_HTTP_429');
});
test('compute receives only structured public terms and JSON-only instruction', async () => {
 let received: ComputeInput | undefined;
 const strategy = new AiNegotiationStrategy({ async generate(input) { received = input; return { provider: 'OPENROUTER', model: 'test', text: '{"action":"REJECT","reason":"Cannot agree."}' }; } });
 await strategy.seller(seller);
 expect(received?.jsonMode).toBe(true);
 expect(received?.messages).toHaveLength(2);
 expect(received?.messages[0]?.content).toContain('JSON');
 expect(JSON.parse(received!.messages[1]!.content)).toEqual({ role: 'SELLER', ...seller });
});
