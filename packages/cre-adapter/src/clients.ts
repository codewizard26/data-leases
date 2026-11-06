import { createHash } from 'node:crypto';
import {
  VerificationRequestSchema, VerificationResultSchema,
  type VerificationClient, type VerificationRequest, type VerificationResult,
} from '@data-leases/contracts';
import { evaluateVerification, type VerificationEvidence } from './policy.js';
import {requiredChecksForRequest} from './policy-v2.js';
import { canonical, requestDigest } from './digest.js';
export { requestDigest } from './digest.js';

abstract class MemoryClient implements VerificationClient {
  protected jobs = new Map<string, { digest: string; request: VerificationRequest; result?: VerificationResult }>();
  protected register(input: VerificationRequest) {
    const request = VerificationRequestSchema.parse(input);
    const digest = requestDigest(request);
    const prior = this.jobs.get(request.verificationId);
    if (prior && prior.digest !== digest) throw new Error('VERIFICATION_ID_CONFLICT');
    if (prior) return prior;
    const job = { digest, request } as { digest: string; request: VerificationRequest; result?: VerificationResult };
    this.jobs.set(request.verificationId, job);
    return job;
  }
  abstract submit(input: VerificationRequest): Promise<{ verificationId: string; state: 'PENDING' | 'COMPLETED' }>;
  async getResult(verificationId: string): Promise<VerificationResult | null> {
    const result = this.jobs.get(verificationId)?.result;
    return result ? structuredClone(result) : null;
  }
}

/** Fixture evidence is always MOCK, including when every check passes. */
export class MockVerificationClient extends MemoryClient {
  constructor(private readonly evidence: VerificationEvidence = {}, private readonly clock: () => string = () => new Date().toISOString()) { super(); }
  async submit(input: VerificationRequest) {
    const job = this.register(input);
    job.result ??= evaluateVerification(job.request, this.evidence, 'MOCK', this.clock());
    return { verificationId: job.request.verificationId, state: 'COMPLETED' as const };
  }
}

/** Manual, trusted operator import; never a CRE webhook or proof of DON execution. */
export class CreSimulationVerificationClient extends MemoryClient {
  async submit(input: VerificationRequest) {
    const job = this.register(input);
    return { verificationId: job.request.verificationId, state: job.result ? 'COMPLETED' as const : 'PENDING' as const };
  }

  importArtifact(artifact: { request: VerificationRequest; requestSha256: string; result: VerificationResult; transcriptSha256: string }, transcript: string): void {
    const request = VerificationRequestSchema.parse(artifact.request);
    const result = VerificationResultSchema.parse(artifact.result);
    const job = this.jobs.get(request.verificationId);
    if (!job || requestDigest(request) !== artifact.requestSha256 || job.digest !== artifact.requestSha256) throw new Error('ARTIFACT_REQUEST_MISMATCH');
    if (createHash('sha256').update(transcript).digest('hex') !== artifact.transcriptSha256) throw new Error('ARTIFACT_TRANSCRIPT_MISMATCH');
    if (!transcript.includes(`DATA_LEASES_REQUEST_SHA256:${job.digest}`)) throw new Error('ARTIFACT_REQUEST_NOT_IN_TRANSCRIPT');
    if (result.executionMode !== 'CRE_CLI_SIMULATION' || result.verificationId !== request.verificationId ||
      result.runId !== request.runId || result.providerId !== request.providerId || result.reportSignature !== undefined) throw new Error('ARTIFACT_RESULT_MISMATCH');
    const line = transcript.split('\n').find(l => l.includes('DATA_LEASES_RESULT:'));
    if (!line || canonical(JSON.parse(line.slice(line.indexOf('DATA_LEASES_RESULT:') + 'DATA_LEASES_RESULT:'.length))) !== canonical(result)) throw new Error('ARTIFACT_RESULT_NOT_IN_TRANSCRIPT');
    const lines = transcript.split('\n');
    if (!lines.includes('CLI_EXIT_CODE:0') || !lines.includes('Execution finished signal received')) throw new Error('SIMULATION_NOT_SUCCESSFUL');
    const returned = lines.find(line => line.startsWith('CLI_RETURNED_RESULT:'));
    if (!returned || canonical(JSON.parse(returned.slice('CLI_RETURNED_RESULT:'.length))) !== canonical(result)) throw new Error('CLI_RETURNED_RESULT_MISMATCH');
    if (requiredChecksForRequest(request).some(id => !result.checks.some(c => c.checkId === id)) ||
      new Set(result.checks.map(c => c.checkId)).size !== result.checks.length) throw new Error('MISSING_REQUIRED_CHECKS');
    const status = result.checks.some(c => c.status === 'FAIL') ? 'REJECTED' : result.checks.some(c => c.status === 'UNKNOWN') ? 'INCONCLUSIVE' : 'ACCEPTED';
    if (status !== result.status) throw new Error('INVALID_ACCEPTANCE');
    const normalized = { ...result, rawArtifactRef: `sha256:${artifact.transcriptSha256}` };
    if (job.result && canonical(job.result) !== canonical(normalized)) throw new Error('RESULT_ALREADY_COMMITTED');
    job.result = normalized;
  }
}
