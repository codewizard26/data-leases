import {VerificationRequestSchema,VerificationResultSchema,type VerificationRequest,type VerificationResult,type VerificationCheck} from '@data-leases/contracts';
import {ed25519} from '@noble/curves/ed25519.js';
import {hexToBytes} from '@noble/hashes/utils.js';
import {SERVICE_POLICIES} from './service-catalog.js';
import {readPlan,REFERENCE_RPC_URL} from './read-plans.js';
import {answerSigningBytes,type VerificationAuthority} from './policy-v2.js';
import type {ReferenceObservation} from './policy.js';
export {SERVICE_POLICIES} from './service-catalog.js';
export const SERVICE_CHECKS=['ANSWER_SCHEMA_VALID','POLICY_SUPPORTED','METRIC_UNITS_MATCH','SOURCE_CHAIN_SUPPORTED','SOURCE_CONTRACT_ALLOWED','ANSWER_FRESHNESS_VALID','SOURCE_BLOCK_REFERENCE_VALID','SOURCE_FRESHNESS_VALID','ONCHAIN_REFERENCE_MATCH','EXTERNAL_HTTP_REFERENCE_MATCH','SERVICE_REQUIREMENTS_MET'] as const;
export interface ServiceEvidence {evm?:ReferenceObservation;http?:ReferenceObservation}
export function serviceFor(id:string){return SERVICE_POLICIES.find(service=>service.questionTemplateId===(id==='ETHEREUM_LENDING_LIQUIDITY'?'AAVE_V3_USDC_AVAILABLE_LIQUIDITY':id));}
/** Every service has an explicit policy. Unavailable private sources and unbound AI output cannot pass. */
export function evaluateServiceVerification(input:VerificationRequest,evidence:ServiceEvidence,mode:VerificationResult['executionMode'],executedAt:string,authority:VerificationAuthority={}):VerificationResult {
 const request=VerificationRequestSchema.parse(input),answer=request.answer,service=serviceFor(request.questionTemplateId),plan=readPlan(request.questionTemplateId);
 const checks:VerificationCheck[]=[];
 const add=(checkId:string,status:'PASS'|'FAIL'|'UNKNOWN',reasonCode:string)=>checks.push({checkId,status,reasonCode});
 const supported=Boolean(service&&request.policy.policyId===service.evidencePolicyId&&request.policy.version==='1.0.0'&&answer.methodologyVersion===service.methodologyVersion&&request.policy.maxAgeSeconds<=3600&&BigInt(request.policy.maxAbsDeltaRaw??'0')===0n);
 add('ANSWER_SCHEMA_VALID','PASS','SCHEMA_VALID');
 add('POLICY_SUPPORTED',supported?'PASS':'UNKNOWN',supported?'SERVICE_POLICY_MATCHED':'POLICY_UNSUPPORTED');
 add('METRIC_UNITS_MATCH',!supported?'UNKNOWN':answer.metric===service!.metric&&answer.unit===service!.unit&&request.policy.allowedMetricIds.includes(answer.metric)?'PASS':'FAIL','SERVICE_METRIC_UNITS');
 add('SOURCE_CHAIN_SUPPORTED',answer.chainId==='eip155:1'&&request.policy.allowedChainIds.includes(answer.chainId)?'PASS':'FAIL','SERVICE_CHAIN');
 const now=Date.parse(executedAt);if(!Number.isFinite(now))throw new Error('INVALID_EXECUTION_TIME');
 const fresh=(time:string)=>{const age=now-Date.parse(time);return age>=0&&age<=request.policy.maxAgeSeconds*1000;};
 add('ANSWER_FRESHNESS_VALID',fresh(answer.deliveredAt)&&fresh(request.requestedAt)?'PASS':'FAIL','ANSWER_FRESHNESS');
 const valid=(observation:ReferenceObservation|undefined)=>Boolean(plan&&observation&&observation.chainId==='eip155:1'&&observation.contract.toLowerCase()===plan.contract&&/^\d+$/.test(observation.value)&&/^\d+$/.test(observation.blockNumber)&&/^0x[\da-f]{64}$/i.test(observation.blockHash));
 const evm=valid(evidence.evm)?evidence.evm:undefined,http=valid(evidence.http)?evidence.http:undefined;
 const claimAllowed=!answer.sourceContract||answer.sourceContract.toLowerCase()===plan?.contract;
 add('SOURCE_CONTRACT_ALLOWED',!supported||!plan?'UNKNOWN':!claimAllowed?'FAIL':evm?'PASS':'UNKNOWN',!claimAllowed?'WRONG_CONTRACT':evm?'ALLOWLISTED_CONTRACT_OBSERVED':'REFERENCE_UNAVAILABLE');
 const block=Boolean(evm&&answer.sourceBlockNumber===evm.blockNumber&&answer.sourceBlockHash?.toLowerCase()===evm.blockHash.toLowerCase());
 add('SOURCE_BLOCK_REFERENCE_VALID',block?'PASS':'UNKNOWN',block?'SAME_BLOCK':'REFERENCE_BLOCK_UNAVAILABLE');
 add('SOURCE_FRESHNESS_VALID',evm?(fresh(evm.blockTimestamp)?'PASS':'FAIL'):'UNKNOWN','REFERENCE_FRESHNESS');
 add('ONCHAIN_REFERENCE_MATCH',supported&&block&&evm?(answer.value===evm.value?'PASS':'FAIL'):'UNKNOWN',supported&&block?'VALUE_COMPARISON':'REFERENCE_UNAVAILABLE');
 const comparable=Boolean(block&&http&&evm&&http.blockNumber===evm.blockNumber&&http.blockHash.toLowerCase()===evm.blockHash.toLowerCase());
 add('EXTERNAL_HTTP_REFERENCE_MATCH',supported&&comparable?(http!.value===evm!.value?'PASS':'FAIL'):'UNKNOWN',comparable?'INDEPENDENT_RPC_COMPARISON':'REFERENCE_UNAVAILABLE');
 add('SERVICE_REQUIREMENTS_MET',plan&&supported?'PASS':'UNKNOWN',plan?'FIXED_READ_PLAN':service?.private?'AUTHORIZED_PRIVATE_SOURCE_REQUIRED':service?.operation==='COMPUTE'?'COMPUTATION_OUTPUT_NOT_BOUND':'METHODOLOGY_REFERENCE_REQUIRED');
 if(answer.providerSignature||answer.demoTrustMode==='SIGNED_PROVIDER'||authority.requireProviderSignature){
  const key=authority.providerPublicKeys?.[request.providerId],signature=answer.providerSignature;
  let validSignature=false;try{validSignature=Boolean(key&&signature&&/^[\da-f]{64}$/i.test(key)&&/^ed25519:[\da-f]{128}$/i.test(signature)&&ed25519.verify(hexToBytes(signature.slice(8)),answerSigningBytes(answer),hexToBytes(key),{zip215:false}));}catch{/* Fail closed for malformed signatures. */}
  add('PROVIDER_SIGNATURE_VALID',!key?'UNKNOWN':validSignature?'PASS':'FAIL',!key?'PROVIDER_SIGNING_KEY_UNAVAILABLE':validSignature?'PROVIDER_SIGNATURE_VERIFIED':'BAD_SIGNATURE');
 }
 if(authority.allowedProviderIds?.length)add('PROVIDER_ALLOWED',authority.allowedProviderIds.includes(request.providerId)?'PASS':'FAIL','PROVIDER_ALLOWLIST');
 return VerificationResultSchema.parse({schemaVersion:'1.0.0',verificationId:request.verificationId,runId:request.runId,providerId:request.providerId,executionMode:mode,status:checks.some(check=>check.status==='FAIL')?'REJECTED':checks.some(check=>check.status==='UNKNOWN')?'INCONCLUSIVE':'ACCEPTED',checks,executedAt,evidenceRefs:plan&&block?[`eip155:1/block/${evm!.blockNumber}/contract/${plan.contract}`,REFERENCE_RPC_URL]:[],...(evm?{referenceChainId:evm.chainId,referenceBlockNumber:evm.blockNumber,referenceBlockHash:evm.blockHash}:{})});
}
