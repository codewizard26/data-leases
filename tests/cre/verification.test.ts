import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { VerificationRequestSchema, VerificationResultSchema, type VerificationRequest } from '@data-leases/contracts';
import {
  MockVerificationClient, CreSimulationVerificationClient, evaluateVerification, requestDigest,
  LINK_CONTRACT, METADATA_URL, readSimulationOutput, type VerificationEvidence,
} from '@data-leases/cre-adapter';

const now = '2026-11-06T12:00:00.000Z';
const fixture = VerificationRequestSchema.parse(JSON.parse(readFileSync(new URL('./fixtures/request.json', import.meta.url), 'utf8')));
const request = () => structuredClone(fixture);
// Entirely fabricated observations. These tests never establish CLI execution.
const evidence = (): VerificationEvidence => ({ evm: { chainId: 'eip155:1', contract: LINK_CONTRACT,
  blockNumber: fixture.answer.sourceBlockNumber!, blockHash: fixture.answer.sourceBlockHash!,
  blockTimestamp: now, value: '18' },
http: { chainId: 'eip155:1', contract: LINK_CONTRACT, decimals: '18', url: METADATA_URL } });
const evaluate = (r: VerificationRequest, e = evidence()) => evaluateVerification(r, e, 'MOCK', now);

describe('deterministic policy and shared contract', () => {
  it.each(['accepted', 'rejected', 'inconclusive'])('validates the saved %s MOCK result fixture', name => {
    const result = VerificationResultSchema.parse(JSON.parse(readFileSync(new URL(`./fixtures/result-${name}.json`, import.meta.url), 'utf8')));
    expect(result.status).toBe(name.toUpperCase());
    expect(result.executionMode).toBe('MOCK');
    expect(result.runId).toBe(fixture.runId);
  });
  it('roundtrips the canonical request and complete accepted result', () => {
    const req = VerificationRequestSchema.parse(JSON.parse(JSON.stringify(request())));
    const result = evaluate(req);
    expect(VerificationResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(result.status).toBe('ACCEPTED');
    expect(result.executionMode).toBe('MOCK');
    expect(result.checks.every(c => c.status === 'PASS')).toBe(true);
  });
  it('rejects a comparable tampered value', () => {
    const req = request(); req.answer.value = '19';
    const result = evaluate(req);
    expect(result.status).toBe('REJECTED');
    expect(result.checks).toContainEqual(expect.objectContaining({ checkId: 'ONCHAIN_REFERENCE_MATCH', status: 'FAIL' }));
  });
  it.each(['-1', '18.0', '99999999999999999999999999999999999999'])('rejects nonmatching exact value %s', value => {
    const req = request(); req.answer.value = value;
    expect(evaluate(req).status).toBe('REJECTED');
  });
  it.each(['evm', 'http'] as const)('is inconclusive with unavailable %s', source => {
    const e = evidence(); delete e[source];
    expect(evaluate(request(), e).status).toBe('INCONCLUSIVE');
  });
  it.each(['sourceBlockHash', 'sourceBlockNumber'] as const)('does not compare a different %s', key => {
    const req = request();
    req.answer[key] = key === 'sourceBlockHash' ? `0x${'22'.repeat(32)}` : '21000001';
    req.answer.value = '19';
    const result = evaluate(req);
    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.checks.find(c => c.checkId === 'ONCHAIN_REFERENCE_MATCH')?.status).toBe('UNKNOWN');
  });
  it.each(['deliveredAt', 'requestedAt', 'blockTimestamp'] as const)('rejects stale %s', key => {
    const req = request(); const e = evidence(); const old = '2026-11-06T10:00:00.000Z';
    if (key === 'deliveredAt') req.answer.deliveredAt = old;
    else if (key === 'requestedAt') req.requestedAt = old;
    else e.evm!.blockTimestamp = old;
    expect(evaluate(req, e).status).toBe('REJECTED');
  });
  it('rejects future timestamps and treats unsupported tolerance as inconclusive', () => {
    const req = request(); req.answer.deliveredAt = '2026-11-06T12:01:00.000Z';
    expect(evaluate(req).status).toBe('REJECTED');
    req.answer.deliveredAt = now; req.policy.maxAbsDeltaRaw = '100';
    expect(evaluate(req).status).toBe('INCONCLUSIVE');
  });
  it.each(['runId', 'sessionId', 'providerId', 'questionTemplateId'] as const)('rejects mismatched answer %s', key => {
    const req = request(); req.answer[key] = 'wrong';
    expect(() => evaluate(req)).toThrow();
  });
  it('rejects forbidden chain, contract and units under the supported method', () => {
    for (const changes of [{ chainId: 'eip155:11155111' }, { sourceContract: `0x${'00'.repeat(20)}` },
      { unit: 'wei' }]) {
      const req = request(); Object.assign(req.answer, changes);
      expect(evaluate(req).status).toBe('REJECTED');
    }
  });
  it('does not pretend to verify a provider signature', () => {
    const req = request(); req.answer.demoTrustMode = 'SIGNED_PROVIDER'; req.answer.providerSignature = 'unverified-demo-signature';
    expect(evaluate(req).status).toBe('INCONCLUSIVE');
  });
  it('treats a redirected/wrong HTTP source as unavailable and a comparable contradiction as rejected', () => {
    const e = evidence(); e.http!.url = 'https://attacker.example/token';
    expect(evaluate(request(), e).status).toBe('INCONCLUSIVE');
    e.http!.url = METADATA_URL; e.http!.decimals = '19';
    expect(evaluate(request(), e).status).toBe('REJECTED');
  });
  it('rejects malformed inputs without executing a job', async () => {
    const req = request(); req.answer.sourceBlockNumber = '0x1';
    await expect(new MockVerificationClient().submit(req)).rejects.toThrow();
  });
});

describe('authoritative CLI return transport', () => {
  const envelope = { requestSha256: 'a'.repeat(64), result: { status: 'ACCEPTED' } };
  const transcript = () => `✓ Workflow Simulation Result:\n${JSON.stringify(JSON.stringify(envelope))}\n2026-11-07T00:16:58Z [SIMULATION] Execution finished signal received\n`;
  it('reads the returned envelope without relying on best-effort user logs', () => {
    expect(readSimulationOutput(transcript())).toEqual(envelope);
  });
  it('rejects missing completion, duplicate returns and malformed envelopes', () => {
    expect(() => readSimulationOutput(transcript().replace('Execution finished signal received', 'Timed out'))).toThrow('MISSING_CLI_COMPLETION_EVIDENCE');
    expect(() => readSimulationOutput(transcript() + transcript())).toThrow('MISSING_CLI_COMPLETION_EVIDENCE');
    expect(() => readSimulationOutput(transcript().replace('a'.repeat(64), 'not-a-digest'))).toThrow('INVALID_CLI_RETURN');
    expect(() => readSimulationOutput('WorkflowExecutionFinished - Status: SUCCESS')).toThrow('MISSING_CLI_COMPLETION_EVIDENCE');
  });
});

describe('client lifecycle and trusted simulation import', () => {
  it.each(['accepted', 'rejected', 'inconclusive'])('imports the recorded real CLI %s artifact and preserves correlation', async name => {
    const artifact = JSON.parse(readFileSync(new URL(`./evidence/${name}.artifact.json`, import.meta.url), 'utf8'));
    const transcript = readFileSync(new URL(`./evidence/${name}.log`, import.meta.url), 'utf8');
    const client = new CreSimulationVerificationClient();
    const request = VerificationRequestSchema.parse(artifact.request);
    await client.submit(request); client.importArtifact(artifact, transcript);
    const result = VerificationResultSchema.parse(await client.getResult(request.verificationId));
    expect(result.status).toBe(name.toUpperCase());
    expect(result.executionMode).toBe('CRE_CLI_SIMULATION');
    expect(result.runId).toBe(request.runId);
  });
  it('keeps mocks honestly labelled and snapshots requests/results', async () => {
    const client = new MockVerificationClient(evidence(), () => now);
    const req = request();
    expect(await client.getResult('missing')).toBeNull();
    expect(await client.submit(req)).toEqual({ verificationId: req.verificationId, state: 'COMPLETED' });
    const result = (await client.getResult(req.verificationId))!;
    result.status = 'REJECTED'; req.answer.value = '19';
    expect((await client.getResult(req.verificationId))?.status).toBe('ACCEPTED');
    expect((await client.getResult(req.verificationId))?.executionMode).toBe('MOCK');
  });
  it('defaults to inconclusive and makes identical retries idempotent', async () => {
    const client = new MockVerificationClient({}, () => now);
    await client.submit(request());
    const first = await client.getResult(fixture.verificationId);
    await client.submit(request());
    expect(await client.getResult(fixture.verificationId)).toEqual(first);
    expect(first?.status).toBe('INCONCLUSIVE');
    const changed = request(); changed.answer.value = '19';
    await expect(client.submit(changed)).rejects.toThrow('VERIFICATION_ID_CONFLICT');
  });
  // Synthetic protocol transcripts exercise ingestion only; never saved as actual CLI evidence.
  function simulatedArtifact(req = request()) {
    const result = evaluateVerification(req, evidence(), 'CRE_CLI_SIMULATION', now);
    const transcript = `SYNTHETIC TEST ONLY\nCLI_EXIT_CODE:0\nDATA_LEASES_REQUEST_SHA256:${requestDigest(req)}\nDATA_LEASES_RESULT:${JSON.stringify(result)}\nCLI_RETURNED_RESULT:${JSON.stringify(result)}\nExecution finished signal received\n`;
    return { artifact: { request: req, requestSha256: requestDigest(req), result,
      transcriptSha256: createHash('sha256').update(transcript).digest('hex') }, transcript };
  }
  it('stays pending until a correlated artifact is imported; repeats are idempotent', async () => {
    const client = new CreSimulationVerificationClient();
    expect((await client.submit(request())).state).toBe('PENDING');
    expect(await client.getResult(fixture.verificationId)).toBeNull();
    const { artifact, transcript } = simulatedArtifact();
    client.importArtifact(artifact, transcript); client.importArtifact(artifact, transcript);
    expect((await client.submit(request())).state).toBe('COMPLETED');
    expect((await client.getResult(fixture.verificationId))?.rawArtifactRef).toBe(`sha256:${artifact.transcriptSha256}`);
  });
  it('rejects a transcript changed after hashing', async () => {
    const client = new CreSimulationVerificationClient(); await client.submit(request());
    const { artifact, transcript } = simulatedArtifact();
    expect(() => client.importArtifact(artifact, transcript + 'changed')).toThrow('ARTIFACT_TRANSCRIPT_MISMATCH');
  });
  it('rejects rebinding a valid transcript to a different answer under identical IDs', async () => {
    const req = request(); const { artifact, transcript } = simulatedArtifact();
    req.answer.value = '19'; artifact.request = req; artifact.requestSha256 = requestDigest(req);
    const client = new CreSimulationVerificationClient(); await client.submit(req);
    expect(() => client.importArtifact(artifact, transcript)).toThrow('ARTIFACT_REQUEST_NOT_IN_TRANSCRIPT');
  });
  it('rejects failures, non-simulation modes and result substitution', async () => {
    const client = new CreSimulationVerificationClient(); await client.submit(request());
    const { artifact, transcript } = simulatedArtifact();
    artifact.result.executionMode = 'LIVE_CRE';
    expect(() => client.importArtifact(artifact, transcript)).toThrow('ARTIFACT_RESULT_MISMATCH');
    artifact.result.executionMode = 'CRE_CLI_SIMULATION'; artifact.result.status = 'REJECTED';
    expect(() => client.importArtifact(artifact, transcript)).toThrow('ARTIFACT_RESULT_NOT_IN_TRANSCRIPT');
    artifact.result.status = 'ACCEPTED';
    const failed = transcript.replace('CLI_EXIT_CODE:0', 'CLI_EXIT_CODE:1');
    artifact.transcriptSha256 = createHash('sha256').update(failed).digest('hex');
    expect(() => client.importArtifact(artifact, failed)).toThrow('SIMULATION_NOT_SUCCESSFUL');
  });
});

describe('unsupported policy and methods stay inconclusive', () => {
  it.each([
    { methodologyVersion: 'unsupported-v2' },
    { metric: 'AAVE_LIQUIDITY' },
  ])('does not assert contradiction for unsupported method %o', changes => {
    const req = request(); Object.assign(req.answer, changes);
    const result = evaluate(req);
    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.checks.some(check => check.status === 'FAIL')).toBe(false);
    expect(result.checks.find(check => check.checkId === 'ONCHAIN_REFERENCE_MATCH')?.status).toBe('UNKNOWN');
  });
  it('does not evaluate sources under an unsupported policy', () => {
    const req = request(); req.policy.policyId = 'unimplemented'; req.answer.evidencePolicyId = 'unimplemented';
    req.answer.value = '19';
    expect(evaluate(req).status).toBe('INCONCLUSIVE');
  });
});

describe('canonical contracts fail closed before policy evaluation', () => {
  it('rejects exponent-form values at the schema boundary', () => {
    const req = request(); req.answer.value = '1e1';
    expect(() => evaluate(req)).toThrow();
  });
  it('rejects an evidence policy not matching the request', () => {
    const req = request(); req.answer.evidencePolicyId = 'other';
    expect(() => evaluate(req)).toThrow();
  });
  it('rejects signed-provider claims without a signature', () => {
    const req = request(); req.answer.demoTrustMode = 'SIGNED_PROVIDER';
    expect(() => evaluate(req)).toThrow();
  });
});
