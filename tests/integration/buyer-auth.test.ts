import {describe,it,expect} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BuyerAuth,bearerToken,privyConfigFromEnv,secureCookiesFromEnv} from '../../apps/agent-gateway/src/buyer-auth.js';
import {BuyerSessionStore} from '../../apps/agent-gateway/src/buyer-session-store.js';
import {allowedWebOrigins} from '../../apps/agent-gateway/src/buyer-http.js';

import {fixtureVerifier} from '../fixtures/privy-verifier.js';
const token=(user:string)=>'fixture-privy-token-'+user;

describe('Privy buyer authentication',()=>{
 it('exchanges a verified token for a session, keeps buyerId stable, rotates and revokes',async()=>{
  const store=new BuyerSessionStore(':memory:');const auth=new BuyerAuth(store,fixtureVerifier);
  try{
   const first=await auth.exchange(token('alice'));const second=await auth.exchange(token('alice'),first.token);
   expect(second.buyerId).toBe(first.buyerId);expect(auth.authenticate(first.token)).toBeUndefined();expect(auth.authenticate(second.token)?.buyerId).toBe(first.buyerId);
   const bob=await auth.exchange(token('bob'));expect(bob.buyerId).not.toBe(first.buyerId);
   expect(()=>auth.assertCsrf(second,'wrong')).toThrow('CSRF_INVALID');auth.assertCsrf(second,second.csrfToken);
   auth.logout(second.token);expect(auth.authenticate(second.token)).toBeUndefined();
  }finally{store.close();}
 });
 it('rejects missing, invalid and unconfigured tokens and other identities on confirmation',async()=>{
  const store=new BuyerSessionStore(':memory:');const auth=new BuyerAuth(store,fixtureVerifier);
  try{
   await expect(auth.exchange(undefined)).rejects.toThrow('PRIVY_TOKEN_REQUIRED');
   await expect(auth.exchange('forged-token-value-123456')).rejects.toThrow('PRIVY_INVALID_TOKEN');
   const alice=await auth.exchange(token('alice'));await auth.exchange(token('mallory'));
   await auth.confirm(token('alice'),alice.buyerId);
   await expect(auth.confirm(token('mallory'),alice.buyerId)).rejects.toThrow('PRIVY_IDENTITY_MISMATCH');
   const unconfigured=new BuyerAuth(store);expect(unconfigured.status().configured).toBe(false);await expect(unconfigured.exchange(token('alice'))).rejects.toThrow('PRIVY_NOT_CONFIGURED');
  }finally{store.close();}
 });
 it('persists only hashed session tokens and expires sessions',()=>{
  const directory=mkdtempSync(join(tmpdir(),'buyer-auth-'));const path=join(directory,'sessions.sqlite');let clock=Date.now();let store=new BuyerSessionStore(path,()=>clock);
  try{const session=store.createSession('privy.io','did:privy:alice',clock/1000);store.close();expect(readFileSync(path).includes(Buffer.from(session.token))).toBe(false);expect(readFileSync(path).includes(Buffer.from('did:privy:alice'))).toBe(false);store=new BuyerSessionStore(path,()=>clock);expect(store.authenticate(session.token)?.buyerId).toBe(session.buyerId);clock+=8*3600_000;expect(store.authenticate(session.token)).toBeUndefined();}
  finally{store.close();rmSync(directory,{recursive:true,force:true});}
 });
 it('parses bearer tokens, env config, cookie security and allowed origins strictly',()=>{
  expect(bearerToken('Bearer '+token('alice'))).toBe(token('alice'));expect(bearerToken('Basic abc')).toBeUndefined();expect(bearerToken('Bearer short')).toBeUndefined();expect(bearerToken(undefined)).toBeUndefined();
  expect(privyConfigFromEnv({PRIVY_APP_ID:'app'})).toBeUndefined();expect(privyConfigFromEnv({PRIVY_APP_ID:'app',PRIVY_VERIFICATION_KEY:'-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----'})?.verificationKey).toContain('\nabc\n');
  expect(secureCookiesFromEnv({})).toBe(true);expect(secureCookiesFromEnv({BUYER_ALLOW_LOCAL_HTTP:'true'})).toBe(false);expect(secureCookiesFromEnv({NODE_ENV:'production',BUYER_ALLOW_LOCAL_HTTP:'true'})).toBe(true);
  const store=new BuyerSessionStore(':memory:');try{expect(new BuyerAuth(store).cookie('t',new Date().toISOString())).toContain('Secure');expect(new BuyerAuth(store,undefined,{secureCookies:false}).cookie('t',new Date().toISOString())).not.toContain('Secure');}finally{store.close();}
  const origins=allowedWebOrigins('http://127.0.0.1:3000',{WEB_ORIGINS:'https://data-leases.vercel.app/, http://evil.example, not a url'});
  expect(origins.has('https://data-leases.vercel.app')).toBe(true);expect(origins.has('http://evil.example')).toBe(false);expect(origins.has('http://localhost:3001')).toBe(true);
 });
});
