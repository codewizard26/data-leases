import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startGateway} from '../../apps/agent-gateway/src/server.js';
import {BuyerAuth} from '../../apps/agent-gateway/src/buyer-auth.js';
import {BuyerSessionStore} from '../../apps/agent-gateway/src/buyer-session-store.js';
import {fixtureVerifier} from '../fixtures/privy-verifier.js';

describe('buyer gateway security boundaries',()=>{
 it('rejects anonymous private reads and mutations, isolates buyers, and revokes logout',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'buyer-http-'));const sessions=new BuyerSessionStore(':memory:');const auth=new BuyerAuth(sessions,fixtureVerifier);const gateway=await startGateway({port:0,dataDirectory:directory,buyerAuth:auth,buyerAuthEnabled:true});
  try{
   for(const path of ['/api/runs','/api/leases','/api/buyer/leases','/api/runs/'+randomUUID(),'/api/sessions/'+randomUUID()+'/history'])expect((await fetch(gateway.baseUrl+path)).status).toBe(401);
   const a=sessions.createSession('privy.io','did:privy:buyera',Date.now()/1000),b=sessions.createSession('privy.io','did:privy:buyerb',Date.now()/1000);
   const headers=(who:typeof a,csrf=true)=>({'Content-Type':'application/json',Origin:gateway.baseUrl,Cookie:'data_leases_buyer='+who.token,...(csrf?{'x-csrf-token':who.csrfToken}:{})});
   const status=await fetch(gateway.baseUrl+'/api/auth/session',{headers:headers(a)});const body=await status.json();expect(body.authenticated).toBe(true);expect(body.buyer.buyerId).toBe(a.buyerId);expect(body.identityHash).toBeUndefined();expect(body.token).toBeUndefined();
   expect((await fetch(gateway.baseUrl+'/api/auth/logout',{method:'POST',headers:headers(a,false),body:'{}'})).status).toBe(403);
   expect((await fetch(gateway.baseUrl+'/api/auth/logout',{method:'POST',headers:{...headers(a),Origin:'https://attacker.example'},body:'{}'})).status).toBe(403);
   const policy={leaseId:randomUUID(),questionTemplateId:'ETHEREUM_LENDING_LIQUIDITY',currency:'hedera:testnet/HBAR',providerIds:['provider-a'],perRequestTinybars:'1',totalTinybars:'10',expiresAt:new Date(Date.now()+3600000).toISOString(),maxAgeSeconds:60,maxRounds:3};
   // Directly create pending private ownership; no Privy authentication or spending success is claimed.
   const {LeaseStore}=await import('../../apps/agent-gateway/src/lease-store.js');const {BuyerStore}=await import('../../apps/agent-gateway/src/buyer-store.js');const leaseStore=new LeaseStore(join(directory,'leases.sqlite'));let approvalId:string;
   try{approvalId=new BuyerStore(leaseStore).request(a.buyerId,policy).approvalId;}finally{leaseStore.close();}
   const own=await fetch(gateway.baseUrl+'/api/buyer/leases',{headers:headers(a)});expect((await own.json()).approvals[0].approvalId).toBe(approvalId);
   const other=await fetch(gateway.baseUrl+'/api/buyer/leases',{headers:headers(b)});expect((await other.json()).approvals).toEqual([]);
   expect((await fetch(gateway.baseUrl+'/api/approvals/'+approvalId+'/deny',{method:'POST',headers:headers(b),body:'{}'})).status).toBeGreaterThanOrEqual(400);
   expect((await fetch(gateway.baseUrl+'/api/leases/'+policy.leaseId,{headers:headers(b)})).status).toBe(404);
   const changedTerms=await fetch(gateway.baseUrl+'/api/approvals/'+approvalId+'/approve',{method:'POST',headers:{...headers(a),Authorization:'Bearer fixture-privy-token-buyera'},body:JSON.stringify({policyHash:'changed'})});expect(changedTerms.status).toBe(400);expect((await changedTerms.json()).error).toBe('APPROVAL_TERMS_CHANGED');
   expect((await fetch(gateway.baseUrl+'/api/approvals/'+approvalId+'/deny',{method:'POST',headers:headers(a),body:'{}'})).status).toBe(200);
   expect((await fetch(gateway.baseUrl+'/api/auth/logout',{method:'POST',headers:headers(a),body:'{}'})).status).toBe(200);
   expect((await fetch(gateway.baseUrl+'/api/runs',{headers:headers(a)})).status).toBe(401);
   expect((await fetch(gateway.baseUrl+'/api/runs',{headers:headers(b)})).status).toBe(200);
   expect((await fetch(gateway.baseUrl+'/api/auth/world/start',{method:'POST',headers:headers(b),body:'{}'})).status).toBe(404);
  }finally{await gateway.close();sessions.close();rmSync(directory,{recursive:true,force:true});}
 });
 it('exchanges a Privy token for a cookie session over HTTP and rejects bad tokens and origins',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'buyer-flow-'));const sessions=new BuyerSessionStore(':memory:');const gateway=await startGateway({port:0,dataDirectory:directory,buyerAuth:new BuyerAuth(sessions,fixtureVerifier),buyerAuthEnabled:true});
  const exchange=(authorization:string|undefined,origin=gateway.baseUrl)=>fetch(gateway.baseUrl+'/api/auth/privy',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},body:'{}'});
  try{
   expect((await exchange(undefined)).status).toBe(401);
   expect((await exchange('Bearer forged-token-value-123456')).status).toBe(401);
   expect((await exchange('Bearer fixture-privy-token-alice','https://attacker.example')).status).toBe(403);
   const result=await exchange('Bearer fixture-privy-token-alice');expect(result.status).toBe(200);const body=await result.json();expect(body.authenticated).toBe(true);expect(JSON.stringify(body)).not.toContain('did:privy');
   const cookie=result.headers.getSetCookie().find(value=>value.startsWith('data_leases_buyer='))!;expect(cookie).toContain('HttpOnly');expect(cookie).toContain('Secure');
   const status=await fetch(gateway.baseUrl+'/api/auth/session',{headers:{Cookie:cookie.split(';')[0]!}});const session=await status.json();expect(session.authenticated).toBe(true);expect(session.buyer.buyerId).toBe(body.buyer.buyerId);expect(session.auth.provider).toBe('PRIVY');
  }finally{await gateway.close();sessions.close();rmSync(directory,{recursive:true,force:true});}
 });

});
