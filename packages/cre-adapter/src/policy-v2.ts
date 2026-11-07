import {ed25519} from '@noble/curves/ed25519.js';
import {hexToBytes} from '@noble/hashes/utils.js';
import {VerificationRequestSchema,VerificationResultSchema,type AnswerEnvelope,type VerificationRequest,type VerificationResult,type VerificationCheck} from '@data-leases/contracts';
import {canonical} from './digest.js';
import {evaluateVerification,LINK_CONTRACT,POLICY,REQUIRED_CHECK_IDS,type VerificationEvidence} from './policy.js';

export const POLICY_V2='link-decimals-v2';
export const REQUIRED_CHECK_IDS_V2=[...REQUIRED_CHECK_IDS,'PROVIDER_ALLOWED','REQUIRED_EVIDENCE_AVAILABLE'] as const;
/** Trusted operator configuration, never supplied by the answer provider. */
export interface VerificationAuthority {
 allowedProviderIds?:readonly string[];
 providerPublicKeys?:Readonly<Record<string,string>>;
 requireProviderSignature?:boolean;
}
export function answerSigningBytes(answer:AnswerEnvelope):Uint8Array {
 const {providerSignature:ignored,...unsigned}=answer;void ignored;
 return new TextEncoder().encode('data-leases:provider-answer:v1\n'+canonical(unsigned));
}
export function evaluateVerificationV2(input:VerificationRequest,evidence:VerificationEvidence,mode:VerificationResult['executionMode'],executedAt:string,authority:VerificationAuthority={}):VerificationResult {
 const request=VerificationRequestSchema.parse(input),answer=request.answer;
 if(request.policy.policyId!==POLICY_V2||request.policy.version!=='2.0.0'||answer.evidencePolicyId!==POLICY_V2){
  return VerificationResultSchema.parse({schemaVersion:'1.0.0',verificationId:request.verificationId,runId:request.runId,providerId:request.providerId,executionMode:mode,status:'INCONCLUSIVE',executedAt,evidenceRefs:[],checks:REQUIRED_CHECK_IDS_V2.map(checkId=>({checkId,status:'UNKNOWN',reasonCode:'POLICY_UNSUPPORTED'}))});
 }
 // Reuse the exact same objective LINK comparison; v1 semantics remain unchanged.
 const base=evaluateVerification({...request,answer:{...answer,evidencePolicyId:POLICY},policy:{...request.policy,policyId:POLICY,version:'1.0.0'}},evidence,mode,executedAt);
 const checks:VerificationCheck[]=base.checks.filter(check=>check.checkId!=='PROVIDER_SIGNATURE_VALID');
 const add=(checkId:string,status:'PASS'|'FAIL'|'UNKNOWN',reasonCode:string)=>checks.push({checkId,status,reasonCode});
 const allowed=authority.allowedProviderIds;
 add('PROVIDER_ALLOWED',allowed?.length?(allowed.includes(request.providerId)?'PASS':'FAIL'):'UNKNOWN',allowed?.length?(allowed.includes(request.providerId)?'PROVIDER_ID_ALLOWLISTED':'PROVIDER_NOT_ALLOWED'):'PROVIDER_POLICY_UNAVAILABLE');
 add('REQUIRED_EVIDENCE_AVAILABLE',evidence.evm&&evidence.http?'PASS':'UNKNOWN',evidence.evm&&evidence.http?'REQUIRED_EVIDENCE_PRESENT':'REFERENCE_UNAVAILABLE');
 const evm=evidence.evm;
 if(evm&&evm.chainId==='eip155:1'&&evm.contract.toLowerCase()===LINK_CONTRACT&&/^\d+$/.test(evm.blockNumber)&&/^0x[\da-f]{64}$/i.test(evm.blockHash)&&answer.sourceBlockNumber===evm.blockNumber&&answer.sourceBlockHash&&answer.sourceBlockHash.toLowerCase()!==evm.blockHash.toLowerCase()){
  const block=checks.find(check=>check.checkId==='SOURCE_BLOCK_REFERENCE_VALID')!;block.status='FAIL';block.reasonCode='BLOCK_HASH_MISMATCH';
 }
 if(answer.providerSignature||answer.demoTrustMode==='SIGNED_PROVIDER'||authority.requireProviderSignature){
  const key=authority.providerPublicKeys?.[request.providerId];const signature=answer.providerSignature;
  if(!signature)add('PROVIDER_SIGNATURE_VALID','FAIL','PROVIDER_SIGNATURE_REQUIRED');
  else if(!/^ed25519:[\da-f]{128}$/i.test(signature))add('PROVIDER_SIGNATURE_VALID','UNKNOWN','SIGNATURE_SCHEME_UNSUPPORTED');
  else if(!key||! /^[\da-f]{64}$/i.test(key))add('PROVIDER_SIGNATURE_VALID','UNKNOWN','PROVIDER_SIGNING_KEY_UNAVAILABLE');
  else {let valid=false;try{valid=ed25519.verify(hexToBytes(signature.slice(8)),answerSigningBytes(answer),hexToBytes(key),{zip215:false});}catch{/* Invalid signatures fail closed. */}add('PROVIDER_SIGNATURE_VALID',valid?'PASS':'FAIL',valid?'PROVIDER_SIGNATURE_VERIFIED':'BAD_SIGNATURE');}
 }
 return VerificationResultSchema.parse({...base,status:checks.some(check=>check.status==='FAIL')?'REJECTED':checks.some(check=>check.status==='UNKNOWN')?'INCONCLUSIVE':'ACCEPTED',checks});
}
export {requiredChecksForRequest} from './required-checks.js';
