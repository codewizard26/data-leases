import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startProvider } from '../../packages/agents/src/index.js';
import * as agents from '../../packages/agents/src/index.js';
import { MockVerificationClient } from '../../packages/cre-adapter/src/index.js';
import * as gateway from '../../apps/agent-gateway/src/server.js';
const cleanup: Array<() => Promise<void>> = [];
let testDirectory='';
beforeEach(async () => {testDirectory=await mkdtemp(join(tmpdir(),'gateway-test-'));vi.stubEnv('DATA_DIRECTORY',testDirectory);vi.stubEnv('COMPUTE_PROVIDER', 'mock'); });
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); vi.unstubAllEnvs(); vi.restoreAllMocks();await rm(testDirectory,{recursive:true,force:true}); });
async function start() { const server = await gateway.startGateway({port: 0}); cleanup.push(server.close); return server; }
test('health exposes mode without credentials and serves browser page', async () => {
  const server = await start();
  const response = await fetch(`${server.baseUrl}/api/health`);
  expect(await response.json()).toMatchObject({status:'ok',compute:{provider:'mock'}});
  const page = await fetch(server.baseUrl,{redirect:'manual'});
  expect(page.status).toBe(200); expect(page.headers.get('content-type')).toContain('text/html');
  const landing = await page.text();
  expect(landing).toContain('id="plan"');
  expect(landing).toContain('href="/dashboard"');
  expect(landing).not.toContain('id="negotiation-form"');
});
test('compute uses deterministic mock by default', async () => {
  const server = await start();
  const response = await fetch(`${server.baseUrl}/api/compute`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'Describe budget policy'})});
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({provider:'MOCK',model:'deterministic'});
});
test('rejects foreign origin and invalid or oversized input', async () => {
  const server = await start();
  const foreign = await fetch(`${server.baseUrl}/api/compute`, {method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{"prompt":"hello"}'});
  expect(foreign.status).toBe(403);
  const invalid = await fetch(`${server.baseUrl}/api/negotiate`, {method:'POST',headers:{'Content-Type':'application/json'},body:'{"maxPriceMinor":"1.5"}'});
  expect(invalid.status).toBe(400);
  const large = await fetch(`${server.baseUrl}/api/compute`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'x'.repeat(9000)})});
  expect(large.status).toBe(413);
});
test('gateway returns actual A2A agreement and rejection transcripts', async () => {
  const a = await startProvider({port:0,providerId:'provider-a',askMinor:'500',floorMinor:'300'});
  const b = await startProvider({port:0,providerId:'provider-b',askMinor:'600',floorMinor:'500'});
  cleanup.push(a.close,b.close);
  const server = await gateway.startGateway({port:0,providerOrigins:[a.baseUrl,b.baseUrl]});cleanup.push(server.close);
  const response = await fetch(`${server.baseUrl}/api/negotiate`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxPriceMinor:'400'})});
  const data = await response.json();
  expect(data.results).toMatchObject([{providerId:'provider-a',status:'AGREED',priceMinor:'400'},{providerId:'provider-b',status:'REJECTED'}]);
  expect(data.results[0].transcript.length).toBeGreaterThan(2);
});

test.each([['COMPUTE_HTTP_429',429,'COMPUTE_RATE_LIMITED'],['COMPUTE_HTTP_401',502,'COMPUTE_AUTH_FAILED'],['secret upstream error',502,'COMPUTE_UNAVAILABLE']] as const)('sanitizes compute failure %s', async (failure,status,code) => {
  vi.spyOn(agents,'createComputeAdapter').mockReturnValue({generate:async () => {throw new Error(failure);}});
  const server = await start();
  const response = await fetch(`${server.baseUrl}/api/compute`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'hello'})});
  expect(response.status).toBe(status); expect(await response.json()).toEqual({error:code});
});

test('catalog exposes scoped services and hides retired tasks and all paid values', async () => {
  const server = await start();
  const response = await fetch(`${server.baseUrl}/api/templates`);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.templates).toHaveLength(25);expect(body.templates.some((item:{operation:string})=>item.operation==='WRITE')).toBe(false);expect(body.templates.every((item:Record<string,unknown>)=>!('value' in item)&&!('computationPrompt' in item))).toBe(true);expect(body.templates.filter((item:{dataAccess:{classification:string}})=>item.dataAccess.classification==='PRIVATE')).toHaveLength(10);
  expect(body.templates.every((item: {demoTrustMode: string}) => item.demoTrustMode === 'UNTRUSTED_MOCK')).toBe(true);
});
test('rejects unknown question template before contacting providers', async () => {
  const server = await start();
  const response = await fetch(`${server.baseUrl}/api/negotiate`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxPriceMinor:'400',questionTemplateId:'UNRESTRICTED_PROMPT'})});
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({error:'INVALID_QUESTION_TEMPLATE'});
});
test('selected mock scenario returns correlated answer and transport details', async () => {
  const a = await startProvider({port:0,providerId:'provider-a',askMinor:'500',floorMinor:'300'});
  const b = await startProvider({port:0,providerId:'provider-b',askMinor:'600',floorMinor:'500'});
  cleanup.push(a.close,b.close);
  const server = await gateway.startGateway({port:0,providerOrigins:[a.baseUrl,b.baseUrl]});cleanup.push(server.close);
  const response = await fetch(`${server.baseUrl}/api/negotiate`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxPriceMinor:'400',questionTemplateId:'AAVE_V3_USDC_AVAILABLE_LIQUIDITY'})});
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.results[0]).toMatchObject({protocol:'A2A 1.0 JSONRPC',cardUrl:`${a.baseUrl}/.well-known/agent-card.json`,a2aEndpoint:`${a.baseUrl}/a2a`, stages:{discovery:'DISCOVERED',negotiation:'AGREED',answer:'DELIVERED_UNVERIFIED',verification:'MOCK:INCONCLUSIVE',payment:'DISABLED'},answer:{questionTemplateId:'AAVE_V3_USDC_AVAILABLE_LIQUIDITY',demoTrustMode:'UNTRUSTED_MOCK'}});
  expect(body.results[0].answer.runId).toBe(body.results[0].runId);
});

test('old demo redirects to the dashboard while developer tools remain accessible', async () => {
  const server = await start();
  const redirect=await fetch(`${server.baseUrl}/demo`,{redirect:'manual'});expect(redirect.status).toBe(302);expect(redirect.headers.get('location')).toBe('http://127.0.0.1:3001/dashboard');
  const response = await fetch(`${server.baseUrl}/developer`);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('template-gallery');
});

test('LINK delivery invokes mock verification without inventing independent evidence', async () => {
  const a = await startProvider({port:0,providerId:'provider-a',askMinor:'500',floorMinor:'300'});
  const b = await startProvider({port:0,providerId:'provider-b',askMinor:'600',floorMinor:'500'});
  cleanup.push(a.close,b.close);
  const server = await gateway.startGateway({port:0,providerOrigins:[a.baseUrl,b.baseUrl]});cleanup.push(server.close);
  const response = await fetch(`${server.baseUrl}/api/negotiate`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxPriceMinor:'350',questionTemplateId:'ERC20_TOKEN_METADATA'})});
  const body = await response.json();
  expect(response.status).toBe(200);
  const agreed = body.results[0];
  expect(agreed).toMatchObject({status:'AGREED',answer:{value:'18',unit:'decimal-places'}, verification:{executionMode:'MOCK',status:'INCONCLUSIVE'},stages:{verification:'MOCK:INCONCLUSIVE'}});
  expect(agreed.verification.runId).toBe(agreed.runId);
  expect(agreed.verification.providerId).toBe('provider-a');
  expect(agreed.verification.checks).toEqual(expect.arrayContaining([expect.objectContaining({checkId:'ONCHAIN_REFERENCE_MATCH',status:'UNKNOWN'})]));
  expect(body.results[1].verification).toBeUndefined();
});

test('verification adapter failure preserves delivered answer as inconclusive', async () => {
  vi.spyOn(MockVerificationClient.prototype,'submit').mockRejectedValue(new Error('upstream private detail'));
  const a = await startProvider({port:0,providerId:'provider-a',askMinor:'500',floorMinor:'300'});
  const b = await startProvider({port:0,providerId:'provider-b',askMinor:'600',floorMinor:'500'});
  cleanup.push(a.close,b.close);
  const server = await gateway.startGateway({port:0,providerOrigins:[a.baseUrl,b.baseUrl]});cleanup.push(server.close);
  const response = await fetch(`${server.baseUrl}/api/negotiate`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxPriceMinor:'350',questionTemplateId:'ERC20_TOKEN_METADATA'})});
  const body = await response.json();
  expect(body.results[0]).toMatchObject({status:'AGREED',answer:{value:'18'},verification:{executionMode:'MOCK',status:'INCONCLUSIVE',checks:[{checkId:'VERIFICATION_ADAPTER_AVAILABLE',status:'UNKNOWN',reasonCode:'ADAPTER_UNAVAILABLE'}]}});
  expect(JSON.stringify(body)).not.toContain('upstream private detail');
});

test('AI negotiation fails closed when a real compute provider is not configured', async () => {
  vi.stubEnv('NEGOTIATION_MODE','ai');
  vi.stubEnv('COMPUTE_PROVIDER','openrouter');
  vi.stubEnv('OPENROUTER_API_KEY','');
  const server = await start();
  const response = await fetch(`${server.baseUrl}/api/negotiate`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxPriceMinor:'350',mode:'LIVE'})});
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({error:'AI_NEGOTIATION_NOT_CONFIGURED'});
});

test('MOCK mode makes no inference calls even when live compute is configured', async () => {
  vi.stubEnv('COMPUTE_PROVIDER','openrouter');vi.stubEnv('OPENROUTER_API_KEY','not-used');
  const adapter = vi.spyOn(agents,'createComputeAdapter').mockImplementation(()=>{throw new Error('MOCK_MUST_NOT_CREATE_COMPUTE');});
  const a=await startProvider({port:0,providerId:'provider-a',askMinor:'500',floorMinor:'300'});
  const b=await startProvider({port:0,providerId:'provider-b',askMinor:'600',floorMinor:'500'});cleanup.push(a.close,b.close);
  const server=await gateway.startGateway({port:0,providerOrigins:[a.baseUrl,b.baseUrl]});cleanup.push(server.close);
  const response=await fetch(server.baseUrl+'/api/negotiate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'MOCK',maxPriceMinor:'350'})});
  expect(response.status).toBe(200);const data=await response.json();expect(data.results[0]).toMatchObject({status:'AGREED',negotiationMode:'MOCK'});expect(adapter).not.toHaveBeenCalled();
});

test('UI can start and poll a bounded CRE simulation job', async () => {
  const job = {jobId:'job-1',case:'valid' as const,createdAt:new Date().toISOString(),state:'RUNNING' as const};
  const runner = {start:(input: string)=>{expect(input).toBe('valid');return {jobId:job.jobId,state:'RUNNING' as const};},get:(id: string)=>id===job.jobId?job:null};
  const server=await gateway.startGateway({port:0,creRunner:runner});cleanup.push(server.close);
  const response=await fetch(server.baseUrl+'/api/cre/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({case:'valid'})});
  expect(response.status).toBe(202);expect(await response.json()).toMatchObject({jobId:'job-1',state:'RUNNING'});
  const poll=await fetch(server.baseUrl+'/api/cre/jobs/job-1');expect(poll.status).toBe(200);expect(await poll.json()).toEqual(job);
  const invalid=await fetch(server.baseUrl+'/api/cre/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({case:'arbitrary-command'})});expect(invalid.status).toBe(400);
  const foreign=await fetch(server.baseUrl+'/api/cre/simulate',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify({case:'valid'})});expect(foreign.status).toBe(403);
});

test('utility quotes arrive without charging and checkout stays blocked until explicit setup',async()=>{
  const {PaymentJournal}=await import('../../packages/agents/src/index.js');
  vi.stubEnv('HEDERA_PROVIDER_A_ACCOUNT_ID','0.0.123');vi.stubEnv('HEDERA_PROVIDER_B_ACCOUNT_ID','0.0.124');vi.stubEnv('PAYMENTS_ENABLED','false');vi.stubEnv('HEDERA_MAX_PAYMENT_TINYBARS','');
  const aJournal=new PaymentJournal(':memory:'),bJournal=new PaymentJournal(':memory:');
  const a=await startProvider({port:0,providerId:'provider-a',askMinor:'500',floorMinor:'300',payment:{payTo:'0.0.123',journal:aJournal}});
  const b=await startProvider({port:0,providerId:'provider-b',askMinor:'700',floorMinor:'400',payment:{payTo:'0.0.124',journal:bJournal}});
  cleanup.push(async()=>{await a.close();aJournal.close();},async()=>{await b.close();bJournal.close();});
  const server=await gateway.startGateway({port:0,providerOrigins:[a.baseUrl,b.baseUrl]});cleanup.push(server.close);
  const response=await fetch(server.baseUrl+'/api/quotes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({questionTemplateId:'PRIVATE_AAVE_POSITION_HEALTH_FACTOR'})});
  expect(response.status).toBe(200);const data=await response.json();expect(data.paymentReady).toBe(false);expect(data.results).toMatchObject([{providerId:'provider-a',operation:'READ',amountTinybars:'2000',payTo:'0.0.123'},{providerId:'provider-b',operation:'READ',amountTinybars:'2800',payTo:'0.0.124'}]);
  const checkout=await fetch(server.baseUrl+'/api/payments/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quoteId:data.results[0].quoteId,approvedAmountTinybars:'2000'})});expect(checkout.status).toBe(503);expect(await checkout.json()).toEqual({error:'PAYMENT_SETUP_REQUIRED'});
  const setup=await fetch(server.baseUrl+'/api/payments/setup').then(r=>r.json());expect(JSON.stringify(setup)).not.toContain('PRIVATE_KEY=');expect(setup.missing).toContain('HEDERA_MAX_PAYMENT_TINYBARS');
});

test('recurring lease settings persist and can be paused or cancelled without enabling payment',async()=>{
 vi.stubEnv('HEDERA_MAX_PAYMENT_TINYBARS','5000');vi.stubEnv('PAYMENTS_ENABLED','false');const server=await start();const leaseId=crypto.randomUUID();
 const response=await fetch(server.baseUrl+'/api/leases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leaseId,questionTemplateId:'ERC20_TOKEN_METADATA',currency:'hedera:testnet/HBAR',providerIds:['provider-a'],perRequestTinybars:'500',totalTinybars:'2000',expiresAt:new Date(Date.now()+3600000).toISOString(),maxAgeSeconds:60,maxRounds:3,schedule:{intervalSeconds:300,mode:'LOCAL_REGISTRY'}})});
 expect(response.status).toBe(201);const listing=await (await fetch(server.baseUrl+'/api/leases')).json();expect(listing.leases[0]).toMatchObject({leaseId,state:'ACTIVE',remainingTinybars:'2000',policy:{schedule:{intervalSeconds:300}}});
 for(const [action,state] of [['PAUSE','PAUSED'],['CANCEL','CANCELLED']]){const result=await fetch(server.baseUrl+'/api/leases/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leaseId,action})});expect(await result.json()).toEqual({status:state});}
});

test('integration status is public-safe and unconfigured public queries fail explicitly',async()=>{
 const server=await start();vi.stubEnv('ARKIV_PRIVATE_KEY','private-do-not-expose');
 const status=await (await fetch(server.baseUrl+'/api/integrations')).json();expect(status).toMatchObject({arkiv:{connected:false},verification:{executionMode:'CRE_CLI_SIMULATION'}});expect(JSON.stringify(status)).not.toContain('private-do-not-expose');
 expect((await fetch(server.baseUrl+'/api/evidence/latest')).status).toBe(503);
});
test('public evidence route calls the existing Arkiv query adapter and rejects arbitrary metrics',async()=>{
 const queryLatestAcceptedAnswer=vi.fn(async()=>null),queryReceiptsByRunId=vi.fn(async()=>[]);
 const server=await gateway.startGateway({port:0,evidenceQueries:{queryLatestAcceptedAnswer,queryReceiptsByRunId}});cleanup.push(server.close);
 expect(await (await fetch(server.baseUrl+'/api/evidence/latest')).json()).toEqual({answer:null,receipts:[]});expect(queryLatestAcceptedAnswer).toHaveBeenCalledWith({metric:'ERC20_DECIMALS',maxAgeSeconds:86400});
 expect((await fetch(server.baseUrl+'/api/evidence/latest?metric=arbitrary')).status).toBe(400);expect(queryLatestAcceptedAnswer).toHaveBeenCalledTimes(1);
});
