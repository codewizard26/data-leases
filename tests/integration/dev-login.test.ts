import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {LeaseStore} from '../../apps/agent-gateway/src/lease-store.js';
import {BuyerStore} from '../../apps/agent-gateway/src/buyer-store.js';
import {BuyerAuth,devLoginFromEnv} from '../../apps/agent-gateway/src/buyer-auth.js';
import {BuyerSessionStore} from '../../apps/agent-gateway/src/buyer-session-store.js';
import {startGateway} from '../../apps/agent-gateway/src/server.js';
import {fixtureVerifier} from '../fixtures/privy-verifier.js';

let directory:string;let sessions:BuyerSessionStore;let close:(()=>Promise<void>)|undefined;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'dev-login-'));sessions=new BuyerSessionStore(':memory:');vi.stubEnv('HEDERA_MAX_PAYMENT_TINYBARS','5000');vi.stubEnv('PAYMENTS_ENABLED','false');});
afterEach(async()=>{await close?.();close=undefined;sessions.close();vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});
async function gateway(devLogin:boolean){const result=await startGateway({port:0,dataDirectory:directory,buyerAuth:new BuyerAuth(sessions,fixtureVerifier,{devLogin}),buyerAuthEnabled:true});close=result.close;return result.baseUrl;}
const policy=()=>({leaseId:randomUUID(),questionTemplateId:'ERC20_TOKEN_METADATA',currency:'hedera:testnet/HBAR' as const,providerIds:['provider-a'],perRequestTinybars:'500',totalTinybars:'2000',expiresAt:new Date(Date.now()+3600000).toISOString(),maxAgeSeconds:60,maxRounds:3,paymentsAuthorized:true});
const login=(url:string,origin=url,body:unknown={name:'local-buyer'})=>fetch(url+'/api/auth/dev',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});

it('is off unless explicitly enabled, and never in production',async()=>{
 expect(devLoginFromEnv({})).toBe(false);expect(devLoginFromEnv({BUYER_DEV_LOGIN:'true'})).toBe(true);expect(devLoginFromEnv({BUYER_DEV_LOGIN:'true',NODE_ENV:'production'})).toBe(false);
 const url=await gateway(false);expect((await login(url)).status).toBe(404);
 expect((await (await fetch(url+'/api/auth/session')).json()).auth.devLogin).toBe(false);
});
it('accepts only loopback origins and valid names',async()=>{
 const url=await gateway(true);
 expect((await login(url,'https://data-leases.vercel.app')).status).toBe(403);
 expect((await login(url,url,{name:'Robert"); DROP'})).status).toBe(400);
});
it('adopts unowned earlier leases, shows their runs, approves without Privy, and stops when disabled',async()=>{
 const legacy=policy(),runId=randomUUID();
 const leases=new LeaseStore(join(directory,'leases.sqlite'));
 // An earlier lease created while buyer sign-in was off: present in leases, no owner.
 leases.buyerApplyPolicy(legacy,true);leases.claim(runId,{runId,sessionId:runId,leaseId:legacy.leaseId,status:'COMPLETED',paymentStatus:'NOT_REQUESTED',deliveryStatus:'NOT_REQUESTED',verificationStatus:'NOT_REQUESTED',publicationStatus:'NOT_REQUESTED'});
 // A lease owned by a Privy buyer must never be adopted.
 const privyBuyer=sessions.createSession('privy.io','did:privy:owner',Date.now()/1000);const owned=policy();const buyers=new BuyerStore(leases);const ownedApproval=buyers.request(privyBuyer.buyerId,owned);buyers.complete(privyBuyer.buyerId,ownedApproval.approvalId,{buyerId:privyBuyer.buyerId,nonce:ownedApproval.nonce,purpose:ownedApproval.purpose,policyHash:ownedApproval.policyHash},'5000');leases.close();
 const url=await gateway(true);
 const response=await login(url);expect(response.status).toBe(200);const body=await response.json();expect(body.adoptedLeases).toBe(1);expect(body.buyer.provider).toBe('LOCAL_DEV');
 const cookie=response.headers.getSetCookie().find(value=>value.startsWith('data_leases_buyer='))!.split(';')[0]!;const headers={Cookie:cookie,'x-csrf-token':body.csrfToken,'Content-Type':'application/json',Origin:url};
 expect((await fetch(url+'/api/leases/'+legacy.leaseId,{headers})).status).toBe(200);
 expect((await fetch(url+'/api/runs/'+runId,{headers})).status).toBe(200);
 expect((await fetch(url+'/api/leases/'+owned.leaseId,{headers})).status).toBe(404);
 const session=await (await fetch(url+'/api/auth/session',{headers})).json();expect(session.authenticated).toBe(true);expect(session.buyer.provider).toBe('LOCAL_DEV');
 const lease=policy();const {approval}=await (await fetch(url+'/api/leases',{method:'POST',headers,body:JSON.stringify(lease)})).json();
 const approved=await fetch(url+'/api/approvals/'+approval.approvalId+'/approve',{method:'POST',headers,body:JSON.stringify({policyHash:approval.policyHash})});expect(approved.status).toBe(200);
 await close!();close=undefined;
 const off=await gateway(false);expect((await fetch(off+'/api/auth/session',{headers:{Cookie:cookie}}).then(r=>r.json())).authenticated).toBe(false);
});
