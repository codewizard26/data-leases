import {createEvidenceLayerFromEnv} from '@data-leases/arkiv';
import {AiNegotiationStrategy,createComputeAdapter} from '@data-leases/agents';
import {startGateway} from './server.js';
const liveOnly=true;
let strategy:AiNegotiationStrategy|undefined;
if(['openrouter','0g','claude'].includes(process.env.COMPUTE_PROVIDER??'')){try{strategy=new AiNegotiationStrategy(createComputeAdapter());}catch{/* Live availability is reported without falling back to mock inference. */}}
const evidence = process.env.EVIDENCE_LAYER_ENABLED === 'true' ? createEvidenceLayerFromEnv() : undefined;
let gateway: Awaited<ReturnType<typeof startGateway>>;
try {
 await evidence?.rawVerification.resumePending();
 gateway = await startGateway({liveOnly,negotiationStrategy:strategy,port:Number(process.env.WEB_PORT ?? '3000'),verificationClient:evidence?.verification,verificationStatus:evidence?.rawVerification.getStatus.bind(evidence.rawVerification),arkivClient:evidence?.arkiv,evidenceQueries:evidence?.arkiv});
 evidence?.start();
} catch { await evidence?.close(); throw new Error('GATEWAY_STARTUP_FAILED'); }
console.log(`Data Leases local console: ${gateway.baseUrl} · Arkiv=${Boolean(evidence)} · CRE=local CLI simulation`);
let closing=false;
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>{
 if(closing)return;closing=true;
 void gateway.close().then(()=>evidence?.close()).then(()=>process.exit(0),()=>process.exit(1));
});
