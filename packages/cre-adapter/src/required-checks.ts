import type {VerificationRequest} from '@data-leases/contracts';
import {POLICY_V2,REQUIRED_CHECK_IDS_V2} from './policy-v2.js';
import {REQUIRED_CHECK_IDS} from './policy.js';
import {SERVICE_CHECKS} from './service-policy.js';
/** One policy-specific checklist for simulator imports and public receipt publication. */
export function requiredChecksForRequest(request:VerificationRequest):readonly string[]{
 const signatureRequired=Boolean(request.answer.providerSignature||request.answer.demoTrustMode==='SIGNED_PROVIDER');
 if(request.policy.policyId===POLICY_V2)return [...REQUIRED_CHECK_IDS_V2,...(signatureRequired?['PROVIDER_SIGNATURE_VALID']:[])];
 if(request.questionTemplateId==='ERC20_TOKEN_METADATA'&&request.answer.demoTrustMode!=='SIGNED_PROVIDER')return REQUIRED_CHECK_IDS;
 return [...SERVICE_CHECKS,...(signatureRequired?['PROVIDER_SIGNATURE_VALID']:[])];
}
