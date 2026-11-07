import {createHash} from 'node:crypto';
import {scenarioForTemplate} from '@data-leases/agents';
import type {RunState} from './orchestrator.js';
export function isPrivateTask(questionTemplateId:string|undefined){return Boolean(questionTemplateId&&scenarioForTemplate(questionTemplateId)?.dataAccess.classification==='PRIVATE');}
/** Private answers remain in buyer-local transactional storage, not analytical events. */
export function eventDisclosure(questionTemplateId:string|undefined,payload:unknown):unknown {
 if(!isPrivateTask(questionTemplateId))return payload;
 const hidden=new Set(['value','text','observed','expected','evidenceRefs','evidenceRef','sourceContract','sourceBlockNumber','sourceBlockHash','providerSignature']);
 const visit=(item:unknown):unknown=>{
  if(Array.isArray(item))return item.map(visit);
  if(item&&typeof item==='object')return Object.fromEntries(Object.entries(item).map(([key,value])=>[key,hidden.has(key)?'[PRIVATE_BUYER_LOCAL_ONLY]':visit(value)]));
  return item;
 };
 const redacted=visit(payload);return { ...(redacted&&typeof redacted==='object'&&!Array.isArray(redacted)?redacted:{data:redacted}),dataClassification:'PRIVATE',retention:'BUYER_LOCAL_ONLY',privatePayloadSha256:createHash('sha256').update((JSON.stringify(payload)??'null')).digest('hex')};
}
/** A history listing never includes private answer contents. Single-run results require settlement. */
export function discloseRun(run:RunState,history=false):RunState{
 const template=run.answer?.questionTemplateId??run.quote?.questionTemplateId;
 if(!isPrivateTask(template))return run;
 const result=structuredClone(run);
 if(history||run.paymentStatus!=='SETTLED'||run.payment?.success!==true){delete result.answer;delete result.computation;}
 if(result.answer){delete result.answer.sourceContract;delete result.answer.sourceBlockNumber;delete result.answer.sourceBlockHash;result.answer.evidenceRefs=[];}
 if(result.verification){delete result.verification.referenceBlockNumber;delete result.verification.referenceBlockHash;delete result.verification.rawArtifactRef;result.verification={...result.verification,checks:result.verification.checks.map(({observed:ignored,expected:ignoredExpected,evidenceRef:ignoredRef,...check})=>{void ignored;void ignoredExpected;void ignoredRef;return check;}),evidenceRefs:[]};}
 return result;
}
