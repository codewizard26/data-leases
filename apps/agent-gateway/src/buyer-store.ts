import {createHash,randomUUID} from 'node:crypto';
import {BuyerApprovalSchema,BuyerLeasePolicySchema,type BuyerApproval,type BuyerLeasePolicy,type BuyerActionBinding} from '@data-leases/contracts';
import {LeaseStore} from './lease-store.js';

function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value);
}
export function buyerPolicyHash(input:BuyerLeasePolicy):string{return createHash('sha256').update(canonical(BuyerLeasePolicySchema.parse(input))).digest('hex');}
/** Private durable ownership and approvals. World verification is supplied only by the server adapter. */
export class BuyerStore {
 constructor(private readonly leases:LeaseStore,private readonly now:()=>number=Date.now){
  leases.buyerDatabase().exec('CREATE TABLE IF NOT EXISTS buyer_lease_owners(lease_id TEXT PRIMARY KEY,buyer_id TEXT NOT NULL,revision INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS buyer_resource_owners(kind TEXT NOT NULL,id TEXT NOT NULL,buyer_id TEXT NOT NULL,PRIMARY KEY(kind,id));CREATE TABLE IF NOT EXISTS buyer_approvals(id TEXT PRIMARY KEY,value TEXT NOT NULL)');
 }
 private db(){return this.leases.buyerDatabase();}
 assertOwner(buyerId:string,leaseId:string){const row=this.db().prepare('SELECT buyer_id,revision FROM buyer_lease_owners WHERE lease_id=?').get(leaseId);if(!row||row.buyer_id!==buyerId)throw new Error('LEASE_NOT_FOUND');return Number(row.revision);}
 ownResource(buyerId:string,kind:'RUN'|'SESSION'|'VERIFICATION',id:string){const row=this.db().prepare('SELECT buyer_id FROM buyer_resource_owners WHERE kind=? AND id=?').get(kind,id);if(row&&row.buyer_id!==buyerId)throw new Error('RESOURCE_NOT_FOUND');this.db().prepare('INSERT OR IGNORE INTO buyer_resource_owners VALUES(?,?,?)').run(kind,id,buyerId);}
 assertResource(buyerId:string,kind:'RUN'|'SESSION'|'VERIFICATION',id:string){const row=this.db().prepare('SELECT buyer_id FROM buyer_resource_owners WHERE kind=? AND id=?').get(kind,id);if(!row||row.buyer_id!==buyerId)throw new Error('RESOURCE_NOT_FOUND');}
 get(buyerId:string,leaseId:string){const revision=this.assertOwner(buyerId,leaseId);return {leaseId,revision,...this.leases.get(leaseId),schedule:this.leases.schedule(leaseId)};}
 list(buyerId:string){return this.db().prepare('SELECT lease_id FROM buyer_lease_owners WHERE buyer_id=?').all(buyerId).flatMap(row=>{try{return [this.get(buyerId,String(row.lease_id))];}catch{return [];}});}
 request(buyerId:string,input:BuyerLeasePolicy,ttlSeconds=300):BuyerApproval {
  if(!Number.isInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>600)throw new Error('INVALID_APPROVAL_TTL');
  const policy=BuyerLeasePolicySchema.parse(input);
  if(Date.parse(policy.expiresAt)<=this.now()||BigInt(policy.perRequestTinybars)>BigInt(policy.totalTinybars))throw new Error('INVALID_LEASE_POLICY');
  return this.leases.buyerTransaction(()=>{
   if(this.leases.run(policy.leaseId))throw new Error('RESOURCE_ID_CONFLICT');
   const row=this.db().prepare('SELECT buyer_id,revision FROM buyer_lease_owners WHERE lease_id=?').get(policy.leaseId);
   if(row&&row.buyer_id!==buyerId)throw new Error('LEASE_NOT_FOUND');
   if(!row){if(this.db().prepare('SELECT id FROM leases WHERE id=?').get(policy.leaseId))throw new Error('LEASE_NOT_FOUND');this.db().prepare('INSERT INTO buyer_lease_owners VALUES(?,?,0)').run(policy.leaseId,buyerId);}
   const revision=Number(row?.revision??0);
   const approval=BuyerApprovalSchema.parse({approvalId:randomUUID(),buyerId,leaseId:policy.leaseId,baseRevision:revision,policyHash:buyerPolicyHash(policy),purpose:revision===0?'ACTIVATE_LEASE':'INCREASE_AUTHORITY',nonce:randomUUID(),expiresAt:new Date(this.now()+ttlSeconds*1000).toISOString(),status:'PENDING',proposedPolicy:policy});
   this.db().prepare('INSERT INTO buyer_approvals VALUES(?,?)').run(approval.approvalId,JSON.stringify(approval));return approval;
  });
 }
 approval(buyerId:string,id:string):BuyerApproval {
  const row=this.db().prepare('SELECT value FROM buyer_approvals WHERE id=?').get(id);if(!row)throw new Error('APPROVAL_NOT_FOUND');const value=BuyerApprovalSchema.parse(JSON.parse(String(row.value)));if(value.buyerId!==buyerId)throw new Error('APPROVAL_NOT_FOUND');
  if(value.status==='PENDING'&&Date.parse(value.expiresAt)<=this.now()){value.status='EXPIRED';this.saveApproval(value);}return value;
 }
 approvals(buyerId:string){return this.db().prepare('SELECT id FROM buyer_approvals').all().flatMap(row=>{try{return [this.approval(buyerId,String(row.id))];}catch{return [];}});}
 private saveApproval(value:BuyerApproval){this.db().prepare('UPDATE buyer_approvals SET value=? WHERE id=?').run(JSON.stringify(value),value.approvalId);}
 deny(buyerId:string,id:string){return this.leases.buyerTransaction(()=>{const approval=this.approval(buyerId,id);if(approval.status!=='PENDING')throw new Error('APPROVAL_NOT_PENDING');approval.status='DENIED';this.saveApproval(approval);return approval;});}
 complete(buyerId:string,id:string,binding:BuyerActionBinding,operatorCapTinybars:string){
  return this.leases.buyerTransaction(()=>{
   const approval=this.approval(buyerId,id);if(approval.status!=='PENDING')throw new Error('APPROVAL_NOT_PENDING');
   if(binding.buyerId!==buyerId||binding.nonce!==approval.nonce||binding.purpose!==approval.purpose||binding.policyHash!==approval.policyHash)throw new Error('APPROVAL_BINDING_MISMATCH');
   if(this.assertOwner(buyerId,approval.leaseId)!==approval.baseRevision)throw new Error('STALE_POLICY_REVISION');
   if(approval.baseRevision>0){const lease=this.leases.get(approval.leaseId),schedule=this.leases.schedule(approval.leaseId);if(schedule?.state==='CANCELLED'||(!schedule&&!lease.active))throw new Error('LEASE_CANCELLED');}
   if(buyerPolicyHash(approval.proposedPolicy)!==approval.policyHash)throw new Error('APPROVAL_TERMS_CHANGED');
   if(!/^[1-9][0-9]*$/.test(operatorCapTinybars)||BigInt(approval.proposedPolicy.perRequestTinybars)>BigInt(operatorCapTinybars))throw new Error('OPERATOR_CAP_EXCEEDED');
   this.leases.buyerApplyPolicy(approval.proposedPolicy,approval.baseRevision===0);
   this.db().prepare('UPDATE buyer_lease_owners SET revision=revision+1 WHERE lease_id=?').run(approval.leaseId);
   approval.status='APPROVED';this.saveApproval(approval);return this.get(buyerId,approval.leaseId);
  });
 }
 /** Owners may reduce authority without a new World verification flow. */
 reduce(buyerId:string,input:BuyerLeasePolicy,baseRevision:number){return this.leases.buyerTransaction(()=>{
  const policy=BuyerLeasePolicySchema.parse(input),revision=this.assertOwner(buyerId,policy.leaseId);if(revision!==baseRevision)throw new Error('STALE_POLICY_REVISION');const old=this.leases.get(policy.leaseId).policy;
  const unchanged=(key:keyof BuyerLeasePolicy)=>canonical(policy[key])===canonical(old[key]);
  if(BigInt(policy.perRequestTinybars)>BigInt(old.perRequestTinybars)||BigInt(policy.totalTinybars)>BigInt(old.totalTinybars)||Date.parse(policy.expiresAt)>Date.parse(old.expiresAt)||policy.providerIds.some(id=>!old.providerIds.includes(id))||(['questionTemplateId','currency','maxAgeSeconds','maxRounds','schedule'] as const).some(key=>!unchanged(key))||(!old.paymentsAuthorized&&policy.paymentsAuthorized)||(old.maxRuns!==undefined&&(policy.maxRuns===undefined||policy.maxRuns>old.maxRuns)))throw new Error('HUMAN_APPROVAL_REQUIRED');
  this.leases.buyerApplyPolicy(policy,false);this.db().prepare('UPDATE buyer_lease_owners SET revision=revision+1 WHERE lease_id=?').run(policy.leaseId);return this.get(buyerId,policy.leaseId);
 });}
}
