import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {VerificationRequestSchema,AnswerEnvelopeSchema} from '@data-leases/contracts';
import {SERVICE_POLICIES,readPlan} from '@data-leases/cre-adapter';
import {readPublicSource} from '../apps/provider-agent/src/public-source.js';
const directory=resolve('data/tmp/cre/services');await mkdir(directory,{recursive:true,mode:0o700});
const selected=process.argv[2];const services=SERVICE_POLICIES.filter(service=>!selected||service.questionTemplateId===selected);
if(!services.length)throw new Error('UNKNOWN_SERVICE');
for(const service of services){
 const runId=randomUUID(),now=new Date().toISOString();
 let answer=AnswerEnvelopeSchema.parse({schemaVersion:'1.0.0',sessionId:randomUUID(),negotiationId:randomUUID(),runId,providerId:'provider-a',acceptedQuoteId:randomUUID(),questionTemplateId:service.questionTemplateId,chainId:service.chainId,metric:service.metric,unit:service.unit,value:'0',methodologyVersion:service.methodologyVersion,evidencePolicyId:service.evidencePolicyId,sourceContract:service.questionTemplateId==='ERC20_TOKEN_METADATA'?readPlan(service.questionTemplateId)?.contract:undefined,evidenceRefs:[],demoTrustMode:'UNTRUSTED_MOCK',deliveredAt:now});
 let source='UNAVAILABLE';
 if(readPlan(service.questionTemplateId)){
  try{const observation=await readPublicSource(answer);answer=AnswerEnvelopeSchema.parse({...answer,...observation,deliveredAt:new Date().toISOString()});source='ETHEREUM_RPC';}catch{source='RPC_UNAVAILABLE';}
 }
 const request=VerificationRequestSchema.parse({schemaVersion:'1.0.0',verificationId:randomUUID(),runId,sessionId:answer.sessionId,providerId:answer.providerId,questionTemplateId:answer.questionTemplateId,answer,policy:{policyId:answer.evidencePolicyId,version:'1.0.0',allowedChainIds:[answer.chainId],allowedMetricIds:[answer.metric],maxAgeSeconds:300,maxAbsDeltaRaw:'0'},requestedAt:new Date().toISOString()});
 await writeFile(resolve(directory,service.questionTemplateId+'.json'),JSON.stringify(request,null,2)+'\n',{mode:0o600});
 if(source==='ETHEREUM_RPC'){
  const tampered={...request,verificationId:randomUUID(),answer:{...answer,value:(BigInt(answer.value)+1n).toString()}};
  await writeFile(resolve(directory,service.questionTemplateId+'.tampered.json'),JSON.stringify(tampered,null,2)+'\n',{mode:0o600});
 }
 console.log(service.questionTemplateId+': '+source+(source==='ETHEREUM_RPC'?' value='+answer.value+' block='+answer.sourceBlockNumber:''));
}
