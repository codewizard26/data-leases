import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventStore} from '@data-leases/event-store';
import {LeaseStore,type LeasePolicy} from '../../apps/agent-gateway/src/lease-store.js';
import {BuyerStore} from '../../apps/agent-gateway/src/buyer-store.js';
import {WorldSessionStore} from '../../apps/agent-gateway/src/world-session-store.js';
import {WorldAuth} from '../../apps/agent-gateway/src/world-auth.js';
import {startGateway} from '../../apps/agent-gateway/src/server.js';
let directory:string;let close:(()=>Promise<void>)|undefined;let sessions:WorldSessionStore;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'buyer-gateway-'));sessions=new WorldSessionStore(':memory:');vi.stubEnv('HEDERA_MAX_PAYMENT_TINYBARS','5000');vi.stubEnv('PAYMENTS_ENABLED','false');});
afterEach(async()=>{await close?.();close=undefined;sessions.close();vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});
const policy=():LeasePolicy=>({leaseId:randomUUID(),questionTemplateId:'ERC20_TOKEN_METADATA',currency:'hedera:testnet/HBAR',providerIds:['provider-a'],perRequestTinybars:'500',totalTinybars:'2000',expiresAt:new Date(Date.now()+3600000).toISOString(),maxAgeSeconds:60,maxRounds:3,paymentsAuthorized:true});
// Sessions are created directly as a test fixture, never as a production authentication shortcut.
function fixtureBuyer(subject:string){const session=sessions.createSession('https://sandbox.auth.world.org',subject,Math.floor(Date.now()/1000));return {...session,headers:{Cookie:'data_leases_buyer='+session.token,'X-CSRF-Token':session.csrfToken,'Content-Type':'application/json'}};}
async function gateway(){const result=await startGateway({port:0,dataDirectory:directory,worldAuth:new WorldAuth(sessions),buyerAuthEnabled:true});close=result.close;return result.baseUrl;}
it('isolates lease reads, run lists, SSE, Parquet history and unowned mutations',async()=>{
 const alice=fixtureBuyer('alice'),bob=fixtureBuyer('bob'),lease=policy(),runId=randomUUID();
 const leases=new LeaseStore(join(directory,'leases.sqlite'));const buyers=new BuyerStore(leases);const approval=buyers.request(alice.buyerId,lease);buyers.complete(alice.buyerId,approval.approvalId,{buyerId:alice.buyerId,nonce:approval.nonce,purpose:approval.purpose,policyHash:approval.policyHash},'5000');
 leases.claim(runId,{runId,sessionId:runId,leaseId:lease.leaseId,status:'COMPLETED',paymentStatus:'NOT_REQUESTED',deliveryStatus:'NOT_REQUESTED',verificationStatus:'NOT_REQUESTED',publicationStatus:'NOT_REQUESTED'});leases.close();
 const events=new EventStore({directory:join(directory,'events')});events.append({schemaVersion:'1.0.0',eventId:randomUUID(),sessionId:runId,runId,occurredAt:new Date().toISOString(),eventType:'NEGOTIATION_OUTCOME',actorRole:'GATEWAY',actorId:'fixture',direction:'INTERNAL',status:'COMPLETED',payload:{fixture:'alice-private'}});await events.close();
 const url=await gateway();
 expect((await fetch(url+'/api/leases/'+lease.leaseId,{headers:alice.headers})).status).toBe(200);
 expect((await fetch(url+'/api/leases/'+lease.leaseId,{headers:bob.headers})).status).toBe(404);
 expect((await fetch(url+'/api/runs/'+runId,{headers:alice.headers})).status).toBe(200);
 expect((await fetch(url+'/api/runs/'+runId,{headers:bob.headers})).status).toBeGreaterThanOrEqual(400);
 const aliceRuns=await fetch(url+'/api/runs',{headers:alice.headers}).then(r=>r.json()),bobRuns=await fetch(url+'/api/runs',{headers:bob.headers}).then(r=>r.json());expect(aliceRuns.runs).toHaveLength(1);expect(bobRuns.runs).toEqual([]);expect(bobRuns.sessions).toEqual([]);
 expect((await fetch(url+'/api/sessions/'+runId+'/history',{headers:alice.headers})).status).toBe(200);
 for(const path of ['/api/sessions/'+runId+'/history','/api/sessions/'+runId+'/events']){const response=await fetch(url+path,{headers:bob.headers});expect(response.status).toBeGreaterThanOrEqual(400);expect(await response.text()).not.toContain('alice-private');}
 // A buyer cannot claim a lease whose ID collides with someone else's conversation run.
 const collision=await fetch(url+'/api/leases',{method:'POST',headers:bob.headers,body:JSON.stringify({...policy(),leaseId:runId})});expect(collision.status).toBeGreaterThanOrEqual(400);
 for(const suffix of ['history','events'])expect((await fetch(url+'/api/sessions/'+runId+'/'+suffix,{headers:bob.headers})).status).toBeGreaterThanOrEqual(400);
 const controller=new AbortController();const stream=await fetch(url+'/api/sessions/'+runId+'/events',{headers:alice.headers,signal:controller.signal});expect(stream.status).toBe(200);const first=await stream.body!.getReader().read();expect(new TextDecoder().decode(first.value)).toContain('alice-private');controller.abort();
 for(const [path,body] of [['/api/leases/cancel',{leaseId:lease.leaseId}],['/api/leases/control',{leaseId:lease.leaseId,action:'CANCEL'}],['/api/runs',{leaseId:lease.leaseId,runId:randomUUID(),mode:'LOCAL_REGISTRY'}],['/api/runs/refresh',{runId}],['/api/runs/publication',{runId}],['/api/payments/reconcile',{runId}]] as const){const response=await fetch(url+path,{method:'POST',headers:bob.headers,body:JSON.stringify(body)});expect(response.status).toBeGreaterThanOrEqual(400);}
 expect((await fetch(url+'/api/runs')).status).toBe(401);
});
it('keeps activation pending, blocks client approval, enforces CSRF and revokes logout',async()=>{
 const alice=fixtureBuyer('alice'),bob=fixtureBuyer('bob'),url=await gateway(),lease=policy();
 const request=await fetch(url+'/api/leases',{method:'POST',headers:alice.headers,body:JSON.stringify(lease)});expect(request.status).toBe(202);const {approval}=await request.json();expect(approval.status).toBe('PENDING');
 expect((await fetch(url+'/api/leases/'+lease.leaseId,{headers:alice.headers})).status).toBe(404);
 const listing=await fetch(url+'/api/buyer/leases',{headers:alice.headers}).then(r=>r.json());expect(listing.leases).toEqual([]);expect(listing.approvals).toHaveLength(1);
 const bobListing=await fetch(url+'/api/buyer/leases',{headers:bob.headers}).then(r=>r.json());expect(bobListing.approvals).toEqual([]);
 const mutate=(who:typeof alice,path:string,body:unknown,csrf=true)=>fetch(url+path,{method:'POST',headers:{...who.headers,Origin:url,...(!csrf?{'X-CSRF-Token':''}:{})},body:JSON.stringify(body)});
 expect((await mutate(bob,'/api/approvals/'+approval.approvalId+'/deny',{})).status).toBeGreaterThanOrEqual(400);
 expect((await mutate(alice,'/api/approvals/'+approval.approvalId+'/complete',{verified:true})).status).toBeGreaterThanOrEqual(400);
 expect((await mutate(alice,'/api/approvals/'+approval.approvalId+'/deny',{},false)).status).toBe(403);
 expect((await mutate(alice,'/api/approvals/'+approval.approvalId+'/deny',{})).status).toBe(200);
 expect((await fetch(url+'/api/leases/'+lease.leaseId,{headers:alice.headers})).status).toBe(404);
 expect((await mutate(alice,'/api/auth/logout',{})).status).toBe(200);
 expect((await fetch(url+'/api/runs',{headers:alice.headers})).status).toBe(401);
});
