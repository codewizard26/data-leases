import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventStore} from '@data-leases/event-store';
import {LeaseStore,type LeasePolicy} from '../../apps/agent-gateway/src/lease-store.js';
import {BuyerStore} from '../../apps/agent-gateway/src/buyer-store.js';
import {BuyerSessionStore} from '../../apps/agent-gateway/src/buyer-session-store.js';
import {BuyerAuth} from '../../apps/agent-gateway/src/buyer-auth.js';
import {fixtureVerifier} from '../fixtures/privy-verifier.js';
import {startGateway} from '../../apps/agent-gateway/src/server.js';
let directory:string;let close:(()=>Promise<void>)|undefined;let sessions:BuyerSessionStore;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'buyer-gateway-'));sessions=new BuyerSessionStore(':memory:');vi.stubEnv('HEDERA_MAX_PAYMENT_TINYBARS','5000');vi.stubEnv('PAYMENTS_ENABLED','false');});
afterEach(async()=>{await close?.();close=undefined;sessions.close();vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});
const policy=():LeasePolicy=>({leaseId:randomUUID(),questionTemplateId:'ERC20_TOKEN_METADATA',currency:'hedera:testnet/HBAR',providerIds:['provider-a'],perRequestTinybars:'500',totalTinybars:'2000',expiresAt:new Date(Date.now()+3600000).toISOString(),maxAgeSeconds:60,maxRounds:3,paymentsAuthorized:true});
// Sessions are created directly as a test fixture, never as a production authentication shortcut.
function fixtureBuyer(subject:string){const session=sessions.createSession('privy.io','did:privy:'+subject,Math.floor(Date.now()/1000));return {...session,headers:{Cookie:'data_leases_buyer='+session.token,'X-CSRF-Token':session.csrfToken,'Content-Type':'application/json'}};}
async function gateway(){const result=await startGateway({port:0,dataDirectory:directory,buyerAuth:new BuyerAuth(sessions,fixtureVerifier),buyerAuthEnabled:true});close=result.close;return result.baseUrl;}
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
 expect((await fetch(url+'/api/buyer/overview')).status).toBe(401);const ownOverview=await fetch(url+'/api/buyer/overview',{headers:alice.headers}).then(r=>r.json());const otherOverview=await fetch(url+'/api/buyer/overview',{headers:bob.headers}).then(r=>r.json());expect(ownOverview.runs).toHaveLength(1);expect(otherOverview.runs).toEqual([]);
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
 const approve=(who:typeof alice,privyUser:string|undefined,body:unknown={policyHash:approval.policyHash})=>fetch(url+'/api/approvals/'+approval.approvalId+'/approve',{method:'POST',headers:{...who.headers,Origin:url,...(privyUser?{Authorization:'Bearer fixture-privy-token-'+privyUser}:{})},body:JSON.stringify(body)});
 expect((await approve(alice,undefined)).status).toBe(401);
 expect((await approve(alice,'bob')).status).toBe(403);
 expect((await approve(bob,'bob')).status).toBeGreaterThanOrEqual(400);
 expect((await approve(alice,'alice',{policyHash:'changed'})).status).toBe(400);
 expect((await fetch(url+'/api/leases/'+lease.leaseId,{headers:alice.headers})).status).toBe(404);
 expect((await mutate(alice,'/api/approvals/'+approval.approvalId+'/deny',{})).status).toBe(200);
 expect((await fetch(url+'/api/leases/'+lease.leaseId,{headers:alice.headers})).status).toBe(404);
 expect((await mutate(alice,'/api/auth/logout',{})).status).toBe(200);
 expect((await fetch(url+'/api/runs',{headers:alice.headers})).status).toBe(401);
});

it('activates a lease only after the same Privy identity confirms the exact policy',async()=>{
 const alice=fixtureBuyer('alice'),url=await gateway(),lease=policy();
 const {approval}=await (await fetch(url+'/api/leases',{method:'POST',headers:alice.headers,body:JSON.stringify(lease)})).json();
 const approved=await fetch(url+'/api/approvals/'+approval.approvalId+'/approve',{method:'POST',headers:{...alice.headers,Origin:url,Authorization:'Bearer fixture-privy-token-alice'},body:JSON.stringify({policyHash:approval.policyHash})});
 expect(approved.status).toBe(200);expect((await approved.json()).approval.status).toBe('APPROVED');
 expect((await fetch(url+'/api/leases/'+lease.leaseId,{headers:alice.headers})).status).toBe(200);
 const replay=await fetch(url+'/api/approvals/'+approval.approvalId+'/approve',{method:'POST',headers:{...alice.headers,Origin:url,Authorization:'Bearer fixture-privy-token-alice'},body:JSON.stringify({policyHash:approval.policyHash})});expect(replay.status).toBe(409);
});
