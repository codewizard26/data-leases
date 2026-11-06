import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { VerificationRequestSchema } from '@data-leases/contracts';
import { LINK_CONTRACT, POLICY, METRIC, METHOD } from '../src/policy.js';

const output = resolve(import.meta.dirname, '../../../data/tmp/cre');
const rpc = process.env.CRE_ETH_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';
if (new URL(rpc).protocol !== 'https:') throw new Error('HTTPS_RPC_REQUIRED');
const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['finalized', false] }), signal: AbortSignal.timeout(15_000) })
  .catch(() => { throw new Error('RPC_UNAVAILABLE'); });
if (!response.ok) throw new Error('RPC_UNAVAILABLE');
const body = await response.json() as { result?: { number: string; hash: string } };
if (!body.result) throw new Error('FINALIZED_BLOCK_UNAVAILABLE');
const now = new Date().toISOString();
const runId = randomUUID();
const sessionId = randomUUID();
const request = VerificationRequestSchema.parse({ schemaVersion: '1.0.0', verificationId: randomUUID(), runId, sessionId,
  questionTemplateId: 'ERC20_TOKEN_METADATA', providerId: 'cre-demo-provider',
  answer: { schemaVersion: '1.0.0', sessionId, negotiationId: randomUUID(), runId,
    questionTemplateId: 'ERC20_TOKEN_METADATA', providerId: 'cre-demo-provider', acceptedQuoteId: 'unpaid-cre-proof',
    deliveredAt: now, chainId: 'eip155:1', metric: METRIC, value: '18', unit: 'decimal-places',
    sourceContract: LINK_CONTRACT, sourceBlockNumber: BigInt(body.result.number).toString(), sourceBlockHash: body.result.hash,
    methodologyVersion: METHOD, evidenceRefs: [], evidencePolicyId: POLICY, demoTrustMode: 'UNTRUSTED_MOCK' },
  policy: { policyId: POLICY, version: '1.0.0', allowedChainIds: ['eip155:1'], allowedMetricIds: [METRIC],
    maxAgeSeconds: 3600, maxAbsDeltaRaw: '0' }, requestedAt: now });
await mkdir(output, { recursive: true, mode: 0o700 });
for (const [name, value] of Object.entries({ request,
  tampered: { ...request, verificationId: randomUUID(), answer: { ...request.answer, value: '19' } },
  inconclusive: { ...request, verificationId: randomUUID(), answer: { ...request.answer, sourceBlockHash: `0x${'00'.repeat(32)}` } },
})) {
  await writeFile(resolve(output, `${name}.json`), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
console.log('Prepared fresh, unpaid demo requests in data/tmp/cre/{request,tampered,inconclusive}.json');
