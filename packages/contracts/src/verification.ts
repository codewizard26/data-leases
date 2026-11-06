import { z } from 'zod';

const id = z.string().min(1).max(256);
const timestamp = z.string().datetime();
const integer = z.string().regex(/^(0|[1-9][0-9]*)$/).max(78);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const AnswerEnvelopeSchema = z.object({
  schemaVersion: z.literal('1.0.0'), sessionId: id, negotiationId: id, runId: id,
  questionTemplateId: id, providerId: id, acceptedQuoteId: id, deliveredAt: timestamp,
  chainId: id, metric: id, value: z.string().min(1).max(128), unit: id,
  sourceContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  sourceBlockNumber: integer.optional(), sourceBlockHash: hash.optional(),
  methodologyVersion: id, evidenceRefs: z.array(z.string().max(2048)).max(32),
  evidencePolicyId: id, providerSignature: z.string().max(2048).optional(),
  demoTrustMode: z.enum(['UNTRUSTED_MOCK', 'SIGNED_PROVIDER']),
}).strict();
export const VerificationRequestSchema = z.object({
  schemaVersion: z.literal('1.0.0'), verificationId: id, runId: id, sessionId: id,
  questionTemplateId: id, providerId: id, answer: AnswerEnvelopeSchema,
  policy: z.object({ policyId: id, version: id, allowedChainIds: z.array(id).max(32),
    allowedMetricIds: z.array(id).max(32), maxAgeSeconds: z.number().int().nonnegative().safe(),
    maxAbsDeltaRaw: integer.optional(), }).strict(),
  requestedAt: timestamp,
}).strict();
export const VerificationCheckSchema = z.object({
  checkId: id, status: z.enum(['PASS', 'FAIL', 'UNKNOWN']),
  observed: z.string().max(2048).optional(), expected: z.string().max(2048).optional(),
  reasonCode: id, evidenceRef: z.string().max(2048).optional(),
}).strict();
export const VerificationResultSchema = z.object({
  schemaVersion: z.literal('1.0.0'), verificationId: id, runId: id, providerId: id,
  executionMode: z.enum(['MOCK', 'CRE_CLI_SIMULATION', 'LIVE_CRE']),
  status: z.enum(['ACCEPTED', 'REJECTED', 'INCONCLUSIVE']),
  checks: z.array(VerificationCheckSchema).min(1).max(64),
  referenceChainId: id.optional(), referenceBlockNumber: integer.optional(), referenceBlockHash: hash.optional(),
  executedAt: timestamp, evidenceRefs: z.array(z.string().max(2048)).max(64),
  rawArtifactRef: z.string().max(2048).optional(), reportSignature: z.string().max(2048).optional(),
}).strict();
export type AnswerEnvelope = z.infer<typeof AnswerEnvelopeSchema>;
export type VerificationRequest = z.infer<typeof VerificationRequestSchema>;
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export type VerificationMode = VerificationResult['executionMode'];
export type VerificationStatus = VerificationResult['status'];
export interface VerificationClient {
  submit(req: VerificationRequest): Promise<{ verificationId: string; state: 'PENDING' | 'COMPLETED' }>;
  getResult(verificationId: string): Promise<VerificationResult | null>;
}
