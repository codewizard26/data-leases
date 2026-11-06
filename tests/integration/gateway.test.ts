import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startProvider } from '../../packages/agents/src/index.js';
import * as agents from '../../packages/agents/src/index.js';
import * as gateway from '../../apps/agent-gateway/src/server.js';
const cleanup: Array<() => Promise<void>> = [];
beforeEach(() => { vi.stubEnv('COMPUTE_PROVIDER', 'mock'); });
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function start() { const server = await gateway.startGateway({port: 0}); cleanup.push(server.close); return server; }
test('health exposes mode without credentials and serves browser page', async () => {
  const server = await start();
  const response = await fetch(`${server.baseUrl}/api/health`);
  expect(await response.json()).toMatchObject({status:'ok',compute:{provider:'mock'}});
  const page = await fetch(server.baseUrl);
  expect(page.status).toBe(200); expect(page.headers.get('content-type')).toContain('text/html');
});
test('compute uses deterministic mock by default', async () => {
  const server = await start();
  const response = await fetch(`${server.baseUrl}/api/compute`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'Describe budget policy'})});
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({provider:'MOCK',model:'deterministic'});
});
test('rejects foreign origin and invalid or oversized input', async () => {
  const server = await start();
  const foreign = await fetch(`${server.baseUrl}/api/compute`, {method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{"prompt":"hello"}'});
  expect(foreign.status).toBe(403);
  const invalid = await fetch(`${server.baseUrl}/api/negotiate`, {method:'POST',headers:{'Content-Type':'application/json'},body:'{"maxPriceMinor":"1.5"}'});
  expect(invalid.status).toBe(400);
  const large = await fetch(`${server.baseUrl}/api/compute`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'x'.repeat(9000)})});
  expect(large.status).toBe(413);
});
test('gateway returns actual A2A agreement and rejection transcripts', async () => {
  const a = await startProvider({port:0,providerId:'provider-a',askMinor:'500',floorMinor:'300'});
  const b = await startProvider({port:0,providerId:'provider-b',askMinor:'600',floorMinor:'500'});
  cleanup.push(a.close,b.close);
  const server = await gateway.startGateway({port:0,providerOrigins:[a.baseUrl,b.baseUrl]});cleanup.push(server.close);
  const response = await fetch(`${server.baseUrl}/api/negotiate`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxPriceMinor:'400'})});
  const data = await response.json();
  expect(data.results).toMatchObject([{providerId:'provider-a',status:'AGREED',priceMinor:'400'},{providerId:'provider-b',status:'REJECTED'}]);
  expect(data.results[0].transcript.length).toBeGreaterThan(2);
});

test.each([['COMPUTE_HTTP_429',429,'COMPUTE_RATE_LIMITED'],['COMPUTE_HTTP_401',502,'COMPUTE_AUTH_FAILED'],['secret upstream error',502,'COMPUTE_UNAVAILABLE']] as const)('sanitizes compute failure %s', async (failure,status,code) => {
  vi.spyOn(agents,'createComputeAdapter').mockReturnValue({generate:async () => {throw new Error(failure);}});
  const server = await start();
  const response = await fetch(`${server.baseUrl}/api/compute`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'hello'})});
  expect(response.status).toBe(status); expect(await response.json()).toEqual({error:code});
});

test('templates expose three explicit mock use cases', async () => {
  const server = await start();
  const response = await fetch(`${server.baseUrl}/api/templates`);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.templates.map((item: {id: string}) => item.id)).toEqual(['aave-usdc-liquidity','aave-usdc-utilization','dao-treasury-risk']);
  expect(body.templates.every((item: {demoTrustMode: string}) => item.demoTrustMode === 'UNTRUSTED_MOCK')).toBe(true);
});
test('rejects unknown question template before contacting providers', async () => {
  const server = await start();
  const response = await fetch(`${server.baseUrl}/api/negotiate`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxPriceMinor:'400',questionTemplateId:'UNRESTRICTED_PROMPT'})});
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({error:'INVALID_QUESTION_TEMPLATE'});
});
test('selected mock scenario returns correlated answer and transport details', async () => {
  const a = await startProvider({port:0,providerId:'provider-a',askMinor:'500',floorMinor:'300'});
  const b = await startProvider({port:0,providerId:'provider-b',askMinor:'600',floorMinor:'500'});
  cleanup.push(a.close,b.close);
  const server = await gateway.startGateway({port:0,providerOrigins:[a.baseUrl,b.baseUrl]});cleanup.push(server.close);
  const response = await fetch(`${server.baseUrl}/api/negotiate`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxPriceMinor:'400',questionTemplateId:'AAVE_V3_USDC_AVAILABLE_LIQUIDITY'})});
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.results[0]).toMatchObject({protocol:'A2A 1.0 JSONRPC',cardUrl:`${a.baseUrl}/.well-known/agent-card.json`,a2aEndpoint:`${a.baseUrl}/a2a`, stages:{discovery:'DISCOVERED',negotiation:'AGREED',answer:'DELIVERED_UNVERIFIED',verification:'NOT_REQUESTED',payment:'DISABLED'},answer:{questionTemplateId:'AAVE_V3_USDC_AVAILABLE_LIQUIDITY',demoTrustMode:'UNTRUSTED_MOCK'}});
  expect(body.results[0].answer.runId).toBe(body.results[0].runId);
});
