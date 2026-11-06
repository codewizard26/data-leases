import { createServer } from 'node:http';
import { afterEach, expect, test } from 'vitest';
import * as discovery from '../src/index.js';
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); });
async function fixture(mode = 'valid') {
  let base = '';
  const server = createServer((request, response) => {
    if (mode === 'redirect') { response.writeHead(302, {location: 'http://169.254.169.254/'}).end(); return; }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ name: 'provider-a', version: '1.0.0', supportedInterfaces: [{url: mode === 'hostile' ? 'http://169.254.169.254/' : `${base}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0'}], skills: [{id: 'ETHEREUM_LENDING_LIQUIDITY'}] }));
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No server');
  base = `http://127.0.0.1:${address.port}`;
  const cardUrl = `${base}/.well-known/agent-card.json`;
  return {cardUrl, policy: {allowedCardUrls: [cardUrl], allowedEndpointUrls: [`${base}/a2a`]}};
}
const query = {schemaVersion: '1.0.0' as const, sessionId: 's1', mode: 'DIRECT_URL' as const, questionTemplateId: 'ETHEREUM_LENDING_LIQUIDITY', maxPriceMinor: '100', currency: 'demo:USD6', maxAgeSeconds: 60, requestedAt: '2026-11-06T00:00:00Z'};
test('fetches actual allowlisted cards and preserves provenance', async () => {
  const {cardUrl, policy} = await fixture();
  const result = await new discovery.DirectUrlDiscovery(policy).discover({...query, directCardUrl: cardUrl});
  expect(result).toMatchObject([{providerId: 'provider-a', discoverySource: 'DIRECT_URL', capabilityMatched: true}]);
  expect(result[0]?.cardFingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
});
test('rejects unallowlisted URLs before fetching', async () => {
  await expect(new discovery.DirectUrlDiscovery({allowedCardUrls: [], allowedEndpointUrls: []}).discover({...query, directCardUrl: 'http://169.254.169.254/'})).rejects.toThrow('not allowed');
});
test.each(['hostile', 'redirect'])('rejects %s card destinations', async mode => {
  const {cardUrl, policy} = await fixture(mode);
  await expect(new discovery.DirectUrlDiscovery(policy).discover({...query, directCardUrl: cardUrl})).rejects.toThrow();
});
test('registry retrieves two distinct live providers', async () => {
  const a = await fixture(); const b = await fixture();
  const policy = {allowedCardUrls: [...a.policy.allowedCardUrls, ...b.policy.allowedCardUrls], allowedEndpointUrls: [...a.policy.allowedEndpointUrls, ...b.policy.allowedEndpointUrls]};
  const result = await new discovery.LocalRegistryDiscovery(policy.allowedCardUrls, policy).discover({...query, mode: 'LOCAL_REGISTRY'});
  expect(result).toHaveLength(2); expect(result.every(item => item.discoverySource === 'LOCAL_REGISTRY')).toBe(true);
});
test('enforces response byte limit', async () => {
  const {cardUrl, policy} = await fixture();
  await expect(new discovery.DirectUrlDiscovery({...policy, maxBytes: 10}).discover({...query, directCardUrl: cardUrl})).rejects.toThrow('size limit');
});
test('blocks credentials even when developer includes URL in allowlist', async () => {
  const cardUrl = 'http://user:password@127.0.0.1:4101/.well-known/agent-card.json';
  await expect(new discovery.DirectUrlDiscovery({allowedCardUrls: [cardUrl], allowedEndpointUrls: []}).discover({...query, directCardUrl: cardUrl})).rejects.toThrow('not allowed');
});
test('blocks DNS hostnames even when developer includes URL in allowlist', async () => {
  const cardUrl = 'http://localhost:4101/.well-known/agent-card.json';
  await expect(new discovery.DirectUrlDiscovery({allowedCardUrls: [cardUrl], allowedEndpointUrls: []}).discover({...query, directCardUrl: cardUrl})).rejects.toThrow('not allowed');
});
