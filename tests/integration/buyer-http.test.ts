import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {startGateway} from '../../apps/agent-gateway/src/server.js';
import {WorldAuth} from '../../apps/agent-gateway/src/world-auth.js';
import {WorldSessionStore} from '../../apps/agent-gateway/src/world-session-store.js';

describe('buyer gateway security boundaries',()=>{
 it('rejects anonymous private reads and mutations, isolates buyers, and revokes logout',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'buyer-http-'));const sessions=new WorldSessionStore(':memory:');const auth=new WorldAuth(sessions);const gateway=await startGateway({port:0,dataDirectory:directory,worldAuth:auth,buyerAuthEnabled:true});
  try{
   for(const path of ['/api/runs','/api/leases','/api/buyer/leases','/api/runs/'+randomUUID(),'/api/sessions/'+randomUUID()+'/history'])expect((await fetch(gateway.baseUrl+path)).status).toBe(401);
   const a=sessions.createSession('test-issuer','buyer-a',Date.now()/1000),b=sessions.createSession('test-issuer','buyer-b',Date.now()/1000);
   const headers=(who:typeof a,csrf=true)=>({'Content-Type':'application/json',Origin:gateway.baseUrl,Cookie:'data_leases_buyer='+who.token,...(csrf?{'x-csrf-token':who.csrfToken}:{})});
   const status=await fetch(gateway.baseUrl+'/api/auth/session',{headers:headers(a)});const body=await status.json();expect(body.authenticated).toBe(true);expect(body.buyer.buyerId).toBe(a.buyerId);expect(body.identityHash).toBeUndefined();expect(body.token).toBeUndefined();
   expect((await fetch(gateway.baseUrl+'/api/auth/logout',{method:'POST',headers:headers(a,false),body:'{}'})).status).toBe(403);
   expect((await fetch(gateway.baseUrl+'/api/auth/logout',{method:'POST',headers:{...headers(a),Origin:'https://attacker.example'},body:'{}'})).status).toBe(403);
   const policy={leaseId:randomUUID(),questionTemplateId:'ETHEREUM_LENDING_LIQUIDITY',currency:'hedera:testnet/HBAR',providerIds:['provider-a'],perRequestTinybars:'1',totalTinybars:'10',expiresAt:new Date(Date.now()+3600000).toISOString(),maxAgeSeconds:60,maxRounds:3};
   // Directly create pending private ownership; no World authentication or spending success is claimed.
   const {LeaseStore}=await import('../../apps/agent-gateway/src/lease-store.js');const {BuyerStore}=await import('../../apps/agent-gateway/src/buyer-store.js');const leaseStore=new LeaseStore(join(directory,'leases.sqlite'));let approvalId:string;
   try{approvalId=new BuyerStore(leaseStore).request(a.buyerId,policy).approvalId;}finally{leaseStore.close();}
   const own=await fetch(gateway.baseUrl+'/api/buyer/leases',{headers:headers(a)});expect((await own.json()).approvals[0].approvalId).toBe(approvalId);
   const other=await fetch(gateway.baseUrl+'/api/buyer/leases',{headers:headers(b)});expect((await other.json()).approvals).toEqual([]);
   expect((await fetch(gateway.baseUrl+'/api/approvals/'+approvalId+'/deny',{method:'POST',headers:headers(b),body:'{}'})).status).toBeGreaterThanOrEqual(400);
   expect((await fetch(gateway.baseUrl+'/api/leases/'+policy.leaseId,{headers:headers(b)})).status).toBe(404);
   const changedTerms=await fetch(gateway.baseUrl+'/api/approvals/'+approvalId+'/start',{method:'POST',headers:headers(a),body:JSON.stringify({policyHash:'changed'})});expect(changedTerms.status).toBe(400);expect((await changedTerms.json()).error).toBe('APPROVAL_TERMS_CHANGED');
   expect((await fetch(gateway.baseUrl+'/api/approvals/'+approvalId+'/deny',{method:'POST',headers:headers(a),body:'{}'})).status).toBe(200);
   expect((await fetch(gateway.baseUrl+'/api/auth/logout',{method:'POST',headers:headers(a),body:'{}'})).status).toBe(200);
   expect((await fetch(gateway.baseUrl+'/api/runs',{headers:headers(a)})).status).toBe(401);
   expect((await fetch(gateway.baseUrl+'/api/runs',{headers:headers(b)})).status).toBe(200);
   expect((await fetch(gateway.baseUrl+'/api/auth/world/start',{method:'POST',headers:headers(b),body:'{}'})).status).toBeGreaterThanOrEqual(400);
  }finally{await gateway.close();sessions.close();rmSync(directory,{recursive:true,force:true});}
 });
 it('binds signed OIDC callback to browser flow and prevents replay over HTTP',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'buyer-flow-'));const sessions=new WorldSessionStore(':memory:');const issuer='https://sandbox.auth.world.org';const keys=generateKeyPairSync('rsa',{modulusLength:2048});let nonce='';
  const fetcher:typeof fetch=async(input)=>{const url=String(input);if(url.endsWith('openid-configuration'))return Response.json({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/keys'});if(url.endsWith('/keys'))return Response.json({keys:[{...keys.publicKey.export({format:'jwk'}),kid:'test-key'}]});const now=Date.now()/1000,encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');const message=encode({alg:'RS256',kid:'test-key'})+'.'+encode({iss:issuer,aud:'test-client',sub:'test-fixture-subject',nonce,exp:now+60,iat:now,auth_time:now,acr:'https://world.org/oidc/acr/orb',amr:['pop']});return Response.json({id_token:message+'.'+sign('RSA-SHA256',Buffer.from(message),keys.privateKey).toString('base64url')});};
  const auth=new WorldAuth(sessions,{issuer,clientId:'test-client',clientSecret:'test-fixture-secret',redirectUri:'http://127.0.0.1:3000/api/auth/world/callback',allowLocalHttp:true},fetcher);const gateway=await startGateway({port:0,dataDirectory:directory,worldAuth:auth,buyerAuthEnabled:true});
  try{
   const start=await fetch(gateway.baseUrl+'/api/auth/world/start',{method:'POST',headers:{Origin:gateway.baseUrl,'Content-Type':'application/json'},body:'{}'});expect(start.status).toBe(200);const body=await start.json(),url=new URL(body.authorizationUrl);nonce=url.searchParams.get('nonce')!;const flowCookie=start.headers.get('set-cookie')!.split(';')[0]!;
   const callback=gateway.baseUrl+'/api/auth/world/callback?'+new URLSearchParams({state:url.searchParams.get('state')!,code:'test-fixture-code',iss:issuer});
   expect((await fetch(callback,{redirect:'manual'})).status).toBeGreaterThanOrEqual(400);
   const result=await fetch(callback,{headers:{Cookie:flowCookie},redirect:'manual'});expect(result.status).toBe(303);const sessionCookie=result.headers.getSetCookie().find(value=>value.startsWith('data_leases_buyer='))!.split(';')[0]!;
   const status=await fetch(gateway.baseUrl+'/api/auth/session',{headers:{Cookie:sessionCookie}});expect((await status.json()).authenticated).toBe(true);
   expect((await fetch(callback,{headers:{Cookie:flowCookie},redirect:'manual'})).status).toBeGreaterThanOrEqual(400);
  }finally{await gateway.close();sessions.close();rmSync(directory,{recursive:true,force:true});}
 });

});
