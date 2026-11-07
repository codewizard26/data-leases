import { z } from 'zod';
export const MinorUnitsSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
const id = z.string().min(1);
const timestamp = z.string().datetime();
export const DiscoveryModeSchema = z.enum(["DIRECT_URL", "LOCAL_REGISTRY", "ARKIV", "HYBRID"] as const);
export type DiscoveryMode = z.infer<typeof DiscoveryModeSchema>;
export const NegotiationActionSchema = z.enum(["REQUEST_FOR_QUOTE", "PROPOSE", "COUNTER", "ACCEPT", "REJECT", "EXPIRE", "ERROR"] as const);
export type NegotiationAction = z.infer<typeof NegotiationActionSchema>;
export const VerificationModeSchema = z.enum(["MOCK", "CRE_CLI_SIMULATION", "LIVE_CRE"] as const);
export type VerificationMode = z.infer<typeof VerificationModeSchema>;
export const VerificationStatusSchema = z.enum(["ACCEPTED", "REJECTED", "INCONCLUSIVE"] as const);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;
export const DiscoveryQuerySchema = z.object({schemaVersion: z.literal("1.0.0"),
sessionId: id,
mode: DiscoveryModeSchema,
questionTemplateId: id,
directCardUrl: z.string().url().optional(),
maxPriceMinor: MinorUnitsSchema,
currency: id,
maxAgeSeconds: z.number().int().nonnegative(),
requestedAt: timestamp}).strict().refine(value => value.mode !== "DIRECT_URL" || value.directCardUrl !== undefined, { message: "DIRECT_URL requires directCardUrl", path: ["directCardUrl"] });
export type DiscoveryQuery = z.infer<typeof DiscoveryQuerySchema>;
export const DiscoveredAgentSchema = z.object({providerId: id,
cardUrl: z.string().url(),
a2aEndpoint: z.string().url(),
displayName: id,
supportedQuestionTemplates: z.array(id),
discoverySource: z.enum(["DIRECT_URL", "LOCAL_REGISTRY", "ARKIV"]),
cardFingerprintSha256: z.string().regex(/^[a-f0-9]{64}$/),
fetchedAt: timestamp,
capabilityMatched: z.boolean()}).strict();
export type DiscoveredAgent = z.infer<typeof DiscoveredAgentSchema>;
export const NegotiationMessageSchema = z.object({schemaVersion: z.literal("1.0.0"),
sessionId: id,
negotiationId: id,
messageId: id,
runId: id.optional(),
action: NegotiationActionSchema,
fromAgentId: id,
toAgentId: id,
round: z.number().int().min(1).max(3),
questionTemplateId: id,
quoteId: id.optional(),
offerId: id.optional(),
revision: z.number().int().nonnegative().optional(),
priceMinor: MinorUnitsSchema.optional(),
currency: id.optional(),
evidencePolicyId: id,
maxAgeSeconds: z.number().int().nonnegative(),
deliverySlaSeconds: z.number().int().nonnegative().optional(),
expiresAt: timestamp,
termsHash: id.optional(),
reasonCode: id.optional()}).strict();
export type NegotiationMessage = z.infer<typeof NegotiationMessageSchema>;
export const AnswerEnvelopeSchema = z.object({schemaVersion: z.literal("1.0.0"),
sessionId: id,
negotiationId: id,
runId: id,
questionTemplateId: id,
providerId: id,
acceptedQuoteId: id,
deliveredAt: timestamp,
chainId: id,
metric: id,
value: z.string().regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/),
unit: id,
sourceContract: id.optional(),
sourceBlockNumber: MinorUnitsSchema.optional(),
sourceBlockHash: id.optional(),
methodologyVersion: id,
evidenceRefs: z.array(id),
evidencePolicyId: id,
providerSignature: id.optional(),
demoTrustMode: z.enum(["UNTRUSTED_MOCK", "SIGNED_PROVIDER"])}).strict().refine(value => value.demoTrustMode !== "SIGNED_PROVIDER" || !!value.providerSignature, { message: "SIGNED_PROVIDER requires a signature", path: ["providerSignature"] });
export type AnswerEnvelope = z.infer<typeof AnswerEnvelopeSchema>;
export const VerificationRequestSchema = z.object({schemaVersion: z.literal("1.0.0"),
verificationId: id,
runId: id,
sessionId: id,
questionTemplateId: id,
providerId: id,
answer: AnswerEnvelopeSchema,
policy: z.object({policyId: id,version: id,allowedChainIds: z.array(id),allowedMetricIds: z.array(id),maxAgeSeconds: z.number().int().nonnegative(),maxAbsDeltaRaw: MinorUnitsSchema.optional()}).strict(),
requestedAt: timestamp}).strict().superRefine((value, context) => {
  for (const key of ["runId", "sessionId", "providerId", "questionTemplateId"] as const) {
    if (value[key] !== value.answer[key]) context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Must match answer correlation" });
  }
  if (value.policy.policyId !== value.answer.evidencePolicyId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["policy", "policyId"], message: "Must match answer evidence policy" });
});
export type VerificationRequest = z.infer<typeof VerificationRequestSchema>;
export const VerificationCheckSchema = z.object({checkId: id,
status: z.enum(["PASS", "FAIL", "UNKNOWN"]),
observed: id.optional(),
expected: id.optional(),
reasonCode: id,
evidenceRef: id.optional()}).strict();
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;
export const VerificationResultSchema = z.object({schemaVersion: z.literal("1.0.0"),
verificationId: id,
runId: id,
providerId: id,
executionMode: VerificationModeSchema,
status: VerificationStatusSchema,
checks: z.array(VerificationCheckSchema),
referenceChainId: id.optional(),
referenceBlockNumber: MinorUnitsSchema.optional(),
referenceBlockHash: id.optional(),
executedAt: timestamp,
evidenceRefs: z.array(id),
rawArtifactRef: id.optional(),
reportSignature: id.optional()}).strict().refine(value => value.status !== "ACCEPTED" || (value.checks.length > 0 && value.checks.every(check => check.status === "PASS")), { message: "ACCEPTED requires nonempty passing checks", path: ["checks"] });
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export const ConversationEventTypeSchema = z.enum(["DISCOVERY_STARTED", "DISCOVERY_RESULT", "DISCOVERY_FAILED", "A2A_SENT", "A2A_RECEIVED", "QUOTE", "NEGOTIATION_OUTCOME", "ANSWER_REQUESTED", "ANSWER_DELIVERED", "VERIFICATION_REQUEST", "VERIFICATION_RESULT", "TIMEOUT", "ERROR"]);
export const ConversationEventSchema = z.object({schemaVersion: z.literal("1.0.0"),
eventId: id,
sessionId: id,
negotiationId: id.optional(),
a2aTaskId: id.optional(),
runId: id.optional(),
sequence: z.number().int().nonnegative(),
occurredAt: timestamp,
ingestedAt: timestamp,
eventType: ConversationEventTypeSchema,
actorRole: z.enum(["BUYER_AGENT", "PROVIDER_AGENT", "GATEWAY", "CRE_ADAPTER"]),
actorId: id,
providerId: id.optional(),
direction: z.enum(["IN", "OUT", "INTERNAL"]),
messageId: id.optional(),
status: id,
priceMinor: MinorUnitsSchema.optional(),
currency: id.optional(),
payloadJson: z.string(),
payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
errorCode: id.optional()}).strict();
export type ConversationEvent = z.infer<typeof ConversationEventSchema>;
export interface VerificationClient { submit(input: VerificationRequest): Promise<{ verificationId: string; state: "PENDING" | "COMPLETED" }>; getResult(id: string): Promise<VerificationResult | null>; }

export type {ArkivClient, RunPublicationInput, RunReceiptReference} from './integrations.js';

/** Proposed additive AI result boundary; model text is never verification evidence. */
export const ComputationResultSchema=z.object({provider:z.enum(['MOCK','0G','CLAUDE','OPENROUTER']),model:z.string().min(1).max(256),text:z.string().min(1).max(8000)}).strict();
export type ComputationResult=z.infer<typeof ComputationResultSchema>;

export * from "./lease-policy.js";

export * from './bundle.js';
