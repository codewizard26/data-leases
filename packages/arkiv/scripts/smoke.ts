import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createEvidenceLayerFromEnv} from '../src/index.js';
const layer=createEvidenceLayerFromEnv();
try{
 const action=process.argv[2]??'read';
 if(action==='publish-offers'){
  if(process.env.ARKIV_PUBLISHING_ENABLED!=='true')throw new Error('ARKIV_PUBLISHING_DISABLED');
  const now=new Date().toISOString();const quotesResponse=await fetch('http://127.0.0.1:3000/api/quotes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({questionTemplateId:'ERC20_TOKEN_METADATA'})});if(!quotesResponse.ok)throw new Error('LOCAL_PROVIDER_QUOTES_UNAVAILABLE');const quoted=await quotesResponse.json() as {results:{providerId:string;status:string;amountTinybars?:string;payTo?:string}[]};const entities=[];
  for(const [index,id] of ['provider-a','provider-b'].entries()){
   const port=4101+index,origin='http://127.0.0.1:'+port;const card=await (await fetch(origin+'/.well-known/agent-card.json')).json() as {name:string;skills:{id:string}[]};if(card.name!==id||!card.skills.some(skill=>skill.id==='ERC20_TOKEN_METADATA'))throw new Error('LOCAL_PROVIDER_CARD_MISMATCH');const quote=quoted.results.find(result=>result.providerId===id&&result.status==='QUOTED');if(!quote?.amountTinybars||!quote.payTo)throw new Error('LOCAL_PROVIDER_QUOTE_UNAVAILABLE');
   const entity=await layer.arkiv.publishProviderOffer({offerId:id+'-link-'+now.replace(/[^0-9]/g,''),providerId:id,questionTemplateId:'ERC20_TOKEN_METADATA',metric:'ERC20_DECIMALS',supportedMetrics:['ERC20_DECIMALS'],priceMinor:quote.amountTinybars,currency:'hedera:testnet/HBAR',asset:'0.0.0',decimals:8,paymentNetwork:'hedera:testnet',payTo:quote.payTo,evidencePolicyId:'link-decimals-v1',cardUrl:origin+'/.well-known/agent-card.json',a2aEndpoint:origin+'/a2a',status:'ACTIVE',reachability:'LOCAL_DEVELOPMENT',createdAt:now,expiresAt:new Date(Date.parse(now)+86400000).toISOString()});entities.push({kind:entity.record.entityType,entityKey:entity.entityKey,transactionHash:entity.transactionHash});
  }
  const readback=await layer.arkiv.queryProviderOffers({metric:'ERC20_DECIMALS'});await mkdir(resolve('data/tmp/arkiv'),{recursive:true,mode:0o700});await writeFile(resolve('data/tmp/arkiv/offers-evidence.json'),JSON.stringify({observedAt:new Date().toISOString(),publisher:layer.transport.publisher,network:'Rabdi',entities,readback:readback.map(entity=>({entityKey:entity.entityKey,providerId:entity.record.providerId}))},null,2),{mode:0o600});console.log(JSON.stringify({publisher:layer.transport.publisher,entities,readBackCount:readback.length}));
 }else if(action==='publish-verification'){
  const artifactPath=process.argv[3],transcriptPath=process.argv[4];if(!artifactPath||!transcriptPath)throw new Error('ARTIFACT_AND_TRANSCRIPT_REQUIRED');const artifact=JSON.parse(await readFile(artifactPath,'utf8'));const transcript=await readFile(transcriptPath,'utf8');
  // Store the submitted request without starting another CLI run: restore an already completed proof.
  const registry=layer.rawVerification;await registry.registerRequest(artifact.request);await registry.importArtifact(artifact,transcript);
  const verification=await layer.arkiv.publishVerificationRecord(artifact.request.verificationId);const answer=await layer.arkiv.publishAnswerReceipt(artifact.request.verificationId);const latest=await layer.arkiv.queryLatestAcceptedAnswer({metric:artifact.request.answer.metric,maxAgeSeconds:86400});console.log(JSON.stringify({publisher:layer.transport.publisher,verificationEntity:verification.entityKey,answerEntity:answer.entityKey,transactions:[verification.transactionHash,answer.transactionHash],latestAccepted:latest?.entityKey,publicValuePublished:'value' in answer.record}));
 }else{
  const result=await layer.arkiv.queryProviderOffers({metric:'ERC20_DECIMALS'});console.log(JSON.stringify({network:'Rabdi',publisher:layer.transport.publisher,offers:result.map(entity=>({entityKey:entity.entityKey,providerId:entity.record.providerId}))}));
 }
}catch(error){console.error(error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'ARKIV_SMOKE_FAILED');process.exitCode=1;}finally{await layer.close();}
