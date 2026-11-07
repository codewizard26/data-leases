import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LeaseStore,type LeasePolicy} from '../../apps/agent-gateway/src/lease-store.js';
import {BuyerStore} from '../../apps/agent-gateway/src/buyer-store.js';
import type {BuyerApproval} from '@data-leases/contracts';
const policy=():LeasePolicy=>({leaseId:randomUUID(),questionTemplateId:'TEST',currency:'hedera:testnet/HBAR',providerIds:['provider-a'],perRequestTinybars:'10',totalTinybars:'100',expiresAt:new Date(Date.now()+3600000).toISOString(),maxAgeSeconds:60,maxRounds:3,paymentsAuthorized:true});
const binding=(a:BuyerApproval)=>({buyerId:a.buyerId,nonce:a.nonce,purpose:a.purpose,policyHash:a.policyHash});
describe('buyer approval authority',()=>{
 it('isolates buyers and consumes an exact approval once',()=>{
  const leases=new LeaseStore(':memory:'),buyers=new BuyerStore(leases),p=policy();
  try{const a=buyers.request('alice',p);expect(()=>buyers.approval('bob',a.approvalId)).toThrow('APPROVAL_NOT_FOUND');expect(()=>leases.get(p.leaseId)).toThrow('LEASE_NOT_FOUND');expect(()=>buyers.complete('alice',a.approvalId,{...binding(a),policyHash:'0'.repeat(64)},'10')).toThrow('APPROVAL_BINDING_MISMATCH');expect(buyers.complete('alice',a.approvalId,binding(a),'10').revision).toBe(1);expect(()=>buyers.get('bob',p.leaseId)).toThrow('LEASE_NOT_FOUND');expect(()=>buyers.complete('alice',a.approvalId,binding(a),'10')).toThrow('APPROVAL_NOT_PENDING');}finally{leases.close();}
 });
 it('rejects stale revisions and preserves committed spend through increases',()=>{
  const leases=new LeaseStore(':memory:'),buyers=new BuyerStore(leases),p=policy();
  try{const a=buyers.request('alice',p);buyers.complete('alice',a.approvalId,binding(a),'100');leases.reserve(p.leaseId,randomUUID(),'provider-a','10');const b=buyers.request('alice',{...p,totalTinybars:'200'}),stale=buyers.request('alice',{...p,totalTinybars:'300'});const result=buyers.complete('alice',b.approvalId,binding(b),'100');expect(result.reservedTinybars).toBe('10');expect(result.remainingTinybars).toBe('190');expect(()=>buyers.complete('alice',stale.approvalId,binding(stale),'100')).toThrow('STALE_POLICY_REVISION');expect(()=>buyers.reduce('alice',{...result.policy,totalTinybars:'5',perRequestTinybars:'5'},2)).toThrow('CAP_BELOW_COMMITTED_SPEND');expect(buyers.get('alice',p.leaseId).policy.totalTinybars).toBe('200');}finally{leases.close();}
 });
 it('persists ownership, approval consumption and policy revisions across restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'buyer-store-')),path=join(dir,'leases.sqlite'),p=policy();
  let leases=new LeaseStore(path);
  try{let buyers=new BuyerStore(leases);const a=buyers.request('alice',p);buyers.complete('alice',a.approvalId,binding(a),'100');leases.close();leases=new LeaseStore(path);buyers=new BuyerStore(leases);expect(buyers.get('alice',p.leaseId).revision).toBe(1);expect(()=>buyers.complete('alice',a.approvalId,binding(a),'100')).toThrow('APPROVAL_NOT_PENDING');}finally{leases.close();rmSync(dir,{recursive:true,force:true});}
 });
 it('does not increase authority after cancellation',()=>{
  const leases=new LeaseStore(':memory:'),buyers=new BuyerStore(leases),p=policy();
  try{const a=buyers.request('alice',p);buyers.complete('alice',a.approvalId,binding(a),'100');const increase=buyers.request('alice',{...p,totalTinybars:'200'});leases.cancel(p.leaseId);expect(()=>buyers.complete('alice',increase.approvalId,binding(increase),'100')).toThrow('LEASE_CANCELLED');expect(leases.get(p.leaseId).policy.totalTinybars).toBe('100');}finally{leases.close();}
 });
 it('denied and expired requests never activate a lease',()=>{
  let now=Date.now();const leases=new LeaseStore(':memory:'),buyers=new BuyerStore(leases,()=>now);
  try{const a=buyers.request('alice',policy());buyers.deny('alice',a.approvalId);expect(()=>buyers.complete('alice',a.approvalId,binding(a),'10')).toThrow('APPROVAL_NOT_PENDING');const b=buyers.request('alice',policy(),1);now+=1001;expect(()=>buyers.complete('alice',b.approvalId,binding(b),'10')).toThrow('APPROVAL_NOT_PENDING');expect(buyers.list('alice')).toEqual([]);}finally{leases.close();}
 });
 it('lets owners lower limits but rejects expansions and resource ID guessing',()=>{
  const leases=new LeaseStore(':memory:'),buyers=new BuyerStore(leases),p=policy();
  try{const a=buyers.request('alice',p);buyers.complete('alice',a.approvalId,binding(a),'100');expect(buyers.reduce('alice',{...p,totalTinybars:'90'},1).revision).toBe(2);expect(()=>buyers.reduce('alice',{...p,totalTinybars:'91'},2)).toThrow('HUMAN_APPROVAL_REQUIRED');buyers.ownResource('alice','RUN','run');expect(()=>buyers.assertResource('bob','RUN','run')).toThrow('RESOURCE_NOT_FOUND');expect(()=>buyers.ownResource('bob','RUN','run')).toThrow('RESOURCE_NOT_FOUND');}finally{leases.close();}
 });
});
