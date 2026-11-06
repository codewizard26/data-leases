import {
  VerificationRequestSchema, VerificationResultSchema,
  type VerificationCheck, type VerificationRequest, type VerificationResult,
} from '@data-leases/contracts';

export const LINK_CONTRACT = '0x514910771af9ca656af840dff83e8264ecf986ca';
export const METADATA_URL = 'https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/mainnet.json';
export const METHOD = 'link-decimals-v1';
export const METRIC = 'ERC20_DECIMALS';
export const POLICY = 'link-decimals-v1';
export const REQUIRED_CHECK_IDS = ['ANSWER_SCHEMA_VALID', 'POLICY_SUPPORTED', 'SOURCE_CHAIN_SUPPORTED',
  'SOURCE_CONTRACT_ALLOWED', 'METRIC_UNITS_MATCH', 'ANSWER_FRESHNESS_VALID', 'SOURCE_BLOCK_REFERENCE_VALID',
  'SOURCE_FRESHNESS_VALID', 'ONCHAIN_REFERENCE_MATCH', 'EXTERNAL_HTTP_REFERENCE_MATCH'] as const;

/** Independent observations, never populated from the provider's claimed value. */
export interface ReferenceObservation {
  chainId: string;
  contract: string;
  blockNumber: string;
  blockHash: string;
  blockTimestamp: string;
  value: string;
}

export interface VerificationEvidence {
  evm?: ReferenceObservation;
  http?: { chainId: string; contract: string; decimals: string; url: string };
}

export function evaluateVerification(
  input: VerificationRequest,
  evidence: VerificationEvidence,
  executionMode: VerificationResult['executionMode'],
  executedAt: string,
): VerificationResult {
  const req = VerificationRequestSchema.parse(input);
  const a = req.answer;
  const checks: VerificationCheck[] = [];
  const check = (checkId: string, pass: boolean | undefined, reason: string, observed?: string, expected?: string) => {
    checks.push({ checkId, status: pass === undefined ? 'UNKNOWN' : pass ? 'PASS' : 'FAIL',
      reasonCode: pass ? 'VALIDATION_PASSED' : reason,
      ...(observed === undefined ? {} : { observed }), ...(expected === undefined ? {} : { expected }) });
  };
  check('ANSWER_SCHEMA_VALID', a.runId === req.runId && a.sessionId === req.sessionId &&
    a.providerId === req.providerId && a.questionTemplateId === req.questionTemplateId,
  'ANSWER_BINDING_MISMATCH');
  check('POLICY_SUPPORTED', req.policy.policyId === POLICY && a.evidencePolicyId === POLICY &&
    req.policy.version === '1.0.0' && req.policy.maxAgeSeconds > 0 && req.policy.maxAgeSeconds <= 3600 &&
    BigInt(req.policy.maxAbsDeltaRaw ?? '0') === 0n, 'POLICY_UNSUPPORTED');
  check('SOURCE_CHAIN_SUPPORTED', a.chainId === 'eip155:1' && req.policy.allowedChainIds.includes(a.chainId), 'WRONG_CHAIN');
  check('SOURCE_CONTRACT_ALLOWED', a.sourceContract?.toLowerCase() === LINK_CONTRACT, 'WRONG_CONTRACT');
  check('METRIC_UNITS_MATCH', a.metric === METRIC && req.policy.allowedMetricIds.includes(METRIC) &&
    a.unit === 'decimal-places' && a.methodologyVersion === METHOD && req.questionTemplateId === 'ERC20_TOKEN_METADATA',
  'METHODOLOGY_UNSUPPORTED');
  const now = Date.parse(executedAt);
  if (!Number.isFinite(now)) throw new Error('INVALID_EXECUTION_TIME');
  const fresh = (timestamp: string) => {
    const age = (now - Date.parse(timestamp)) / 1000;
    return Number.isFinite(age) && age >= 0 && age <= req.policy.maxAgeSeconds;
  };
  check('ANSWER_FRESHNESS_VALID', fresh(a.deliveredAt) && fresh(req.requestedAt), 'SOURCE_STALE');
  const evm = evidence.evm;
  const validReference = evm !== undefined && evm.chainId === 'eip155:1' &&
    evm.contract.toLowerCase() === LINK_CONTRACT && /^\d+$/.test(evm.blockNumber) &&
    /^0x[0-9a-fA-F]{64}$/.test(evm.blockHash) && /^\d+$/.test(evm.value);
  const sameBlock = validReference && a.sourceBlockNumber === evm?.blockNumber &&
    a.sourceBlockHash?.toLowerCase() === evm?.blockHash.toLowerCase();
  // Missing or ambiguous block references cannot establish a contradiction about the value.
  check('SOURCE_BLOCK_REFERENCE_VALID', sameBlock ? true : undefined, evm ? 'BLOCK_HASH_MISMATCH' : 'REFERENCE_UNAVAILABLE');
  check('SOURCE_FRESHNESS_VALID', validReference && evm ? fresh(evm.blockTimestamp) : undefined, evm ? 'SOURCE_STALE' : 'REFERENCE_UNAVAILABLE');
  check('ONCHAIN_REFERENCE_MATCH', sameBlock && evm ? /^\d+$/.test(a.value) && BigInt(a.value) === BigInt(evm.value) : undefined,
    'VALUE_MISMATCH', sameBlock ? evm?.value : undefined, a.value);
  const http = evidence.http;
  const comparableHttp = http && http.url === METADATA_URL && http.chainId === 'eip155:1' &&
    http.contract.toLowerCase() === LINK_CONTRACT && /^\d+$/.test(http.decimals);
  check('EXTERNAL_HTTP_REFERENCE_MATCH', comparableHttp && evm && sameBlock ? BigInt(http.decimals) === BigInt(evm.value) : undefined,
    comparableHttp ? 'VALUE_MISMATCH' : 'REFERENCE_UNAVAILABLE', comparableHttp ? http?.decimals : undefined, evm?.value);
  if (a.demoTrustMode === 'SIGNED_PROVIDER' || a.providerSignature !== undefined) {
    check('PROVIDER_SIGNATURE_VALID', undefined, 'SIGNATURE_VERIFICATION_UNSUPPORTED');
  }
  return VerificationResultSchema.parse({ schemaVersion: '1.0.0', verificationId: req.verificationId,
    runId: req.runId, providerId: req.providerId, executionMode,
    status: checks.some(c => c.status === 'FAIL') ? 'REJECTED' : checks.some(c => c.status === 'UNKNOWN') ? 'INCONCLUSIVE' : 'ACCEPTED',
    checks, executedAt,
    ...(validReference && evm ? { referenceChainId: evm.chainId, referenceBlockNumber: evm.blockNumber, referenceBlockHash: evm.blockHash } : {}),
    evidenceRefs: [...(validReference && evm ? [`eip155:1/block/${evm.blockNumber}/contract/${LINK_CONTRACT}`] : []),
      ...(comparableHttp ? [METADATA_URL] : [])],
  });
}
