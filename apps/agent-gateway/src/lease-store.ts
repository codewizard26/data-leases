import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {z} from 'zod';
import {LeasePolicySchema} from '@data-leases/contracts';
export {LeasePolicySchema} from '@data-leases/contracts';
export interface ScheduleRow {leaseId:string;state:string;nextRunAt:number;activeRunId:string|null;lastRunId:string|null;reason:string|null}
export type LeasePolicy=z.infer<typeof LeasePolicySchema>;
/** Durable reservations count uncertain and completed payments against the signed total. */
export class LeaseStore {
 private db:DatabaseSync;
 private privateKey;
 private publicKey;
 constructor(path:string){
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const keyPath=path+'.policy-key.pem';
  const key=path!==':memory:'&&existsSync(keyPath)?createPrivateKey(readFileSync(keyPath)):generateKeyPairSync('ed25519').privateKey;
  if(path!==':memory:'&&!existsSync(keyPath))writeFileSync(keyPath,key.export({type:'pkcs8',format:'pem'}),{mode:0o600,flag:'wx'});
  this.privateKey=key;this.publicKey=createPublicKey(key);
  this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS leases(id TEXT PRIMARY KEY,policy TEXT NOT NULL,signature TEXT NOT NULL,active INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS reservations(run_id TEXT PRIMARY KEY,lease_id TEXT NOT NULL,amount TEXT NOT NULL,status TEXT NOT NULL);CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS lease_schedules(lease_id TEXT PRIMARY KEY,state TEXT NOT NULL,next_run_at INTEGER NOT NULL,active_run_id TEXT,last_run_id TEXT,reason TEXT)');
 }
 authorize(input:LeasePolicy){
  const policy=LeasePolicySchema.parse(input);if(Date.parse(policy.expiresAt)<=Date.now()||BigInt(policy.perRequestTinybars)>BigInt(policy.totalTinybars)||(policy.schedule&&(!policy.paymentsAuthorized||policy.maxRuns===1)))throw new Error('INVALID_LEASE_POLICY');
  const value=JSON.stringify(policy);const existing=this.db.prepare('SELECT policy FROM leases WHERE id=?').get(policy.leaseId);if(existing){if(String(existing.policy)!==value)throw new Error('LEASE_ID_CONFLICT');return this.get(policy.leaseId);}
  const signature=sign(null,Buffer.from(value),this.privateKey).toString('base64');
  this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT INTO leases VALUES(?,?,?,1)').run(policy.leaseId,value,signature);if(policy.schedule)this.db.prepare('INSERT INTO lease_schedules VALUES(?,?,?,NULL,NULL,NULL)').run(policy.leaseId,'ACTIVE',Date.now());this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}return this.get(policy.leaseId);
 }

 get(id:string){const row=this.db.prepare('SELECT * FROM leases WHERE id=?').get(id);if(!row)throw new Error('LEASE_NOT_FOUND');const value=String(row.policy);if(!verify(null,Buffer.from(value),this.publicKey,Buffer.from(String(row.signature),'base64')))throw new Error('POLICY_SIGNATURE_INVALID');const policy=LeasePolicySchema.parse(JSON.parse(value));const held=this.db.prepare("SELECT amount FROM reservations WHERE lease_id=? AND status!='RELEASED'").all(id).reduce((sum,r)=>sum+BigInt(String(r.amount)),0n);return {policy,signature:String(row.signature),active:Boolean(row.active),reservedTinybars:held.toString(),remainingTinybars:(BigInt(policy.totalTinybars)-held).toString()};}
 cancel(id:string){this.get(id);this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('UPDATE leases SET active=0 WHERE id=?').run(id);this.db.prepare("UPDATE lease_schedules SET state='CANCELLED',reason='USER_CANCELLED' WHERE lease_id=?").run(id);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}}
 reserve(leaseId:string,runId:string,providerId:string,amount:string){this.db.exec('BEGIN IMMEDIATE');try{const lease=this.get(leaseId);if(!lease.active||Date.parse(lease.policy.expiresAt)<=Date.now())throw new Error('LEASE_EXPIRED_OR_CANCELLED');if(lease.policy.schedule&&this.schedule(leaseId)?.activeRunId!==runId)throw new Error('SCHEDULED_RUN_REQUIRED');if(lease.policy.maxRuns!==undefined){const count=this.db.prepare("SELECT COUNT(*) AS count FROM reservations WHERE lease_id=? AND status!='RELEASED'").get(leaseId);if(Number(count?.count)>=lease.policy.maxRuns)throw new Error('LEASE_RUN_LIMIT_EXCEEDED');}if(!lease.policy.providerIds.includes(providerId)||!/^[1-9][0-9]*$/.test(amount)||BigInt(amount)>BigInt(lease.policy.perRequestTinybars)||BigInt(amount)>BigInt(lease.remainingTinybars))throw new Error('LEASE_BUDGET_EXCEEDED');this.db.prepare('INSERT INTO reservations VALUES(?,?,?,?)').run(runId,leaseId,amount,'RESERVED');this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
 mark(runId:string,status:'SETTLED'|'UNKNOWN'|'RELEASED'){this.db.prepare('UPDATE reservations SET status=? WHERE run_id=?').run(status,runId);}
 claim(runId:string,value:unknown){return Number(this.db.prepare('INSERT OR IGNORE INTO runs VALUES(?,?)').run(runId,JSON.stringify(value)).changes)===1;}
 save(runId:string,value:unknown){this.db.prepare('UPDATE runs SET value=? WHERE id=?').run(JSON.stringify(value),runId);}
 run(runId:string):unknown{const r=this.db.prepare('SELECT value FROM runs WHERE id=?').get(runId);return r?JSON.parse(String(r.value)):undefined;}
 runs():unknown[]{return this.db.prepare('SELECT value FROM runs ORDER BY rowid DESC LIMIT 100').all().map(r=>JSON.parse(String(r.value)));}
 mandates(){return this.db.prepare('SELECT id FROM leases ORDER BY rowid DESC').all().map(row=>this.get(String(row.id))).filter(lease=>lease.policy.paymentsAuthorized&&!lease.policy.schedule&&lease.policy.maxRuns!==1);}
 schedules():ScheduleRow[]{return this.db.prepare('SELECT lease_id AS leaseId,state,next_run_at AS nextRunAt,active_run_id AS activeRunId,last_run_id AS lastRunId,reason FROM lease_schedules ORDER BY rowid DESC').all() as unknown as ScheduleRow[];}
 schedule(id:string){return this.schedules().find(row=>row.leaseId===id);}
 scheduleState(id:string,state:string,reason:string){this.db.prepare('UPDATE lease_schedules SET state=?,reason=? WHERE lease_id=?').run(state,reason,id);}
 controlSchedule(id:string,action:'PAUSE'|'RESUME'|'CANCEL'){
  const lease=this.get(id),row=this.schedule(id);if(!row)throw new Error('SCHEDULE_NOT_FOUND');if(action==='CANCEL'){this.cancel(id);return;}
  if(!['ACTIVE','PAUSED'].includes(row.state))throw new Error('SCHEDULE_NOT_RESUMABLE');
  if((action==='PAUSE'&&row.state==='PAUSED')||(action==='RESUME'&&row.state==='ACTIVE'))return;
  if(action==='RESUME'){
   if(Date.parse(lease.policy.expiresAt)<=Date.now())throw new Error('LEASE_EXPIRED');
   if(BigInt(lease.remainingTinybars)<=0n)throw new Error('LEASE_BUDGET_EXCEEDED');
   if(this.db.prepare("SELECT id FROM runs WHERE json_extract(value,'$.leaseId')=? AND json_extract(value,'$.paymentStatus')='UNKNOWN' LIMIT 1").get(id))throw new Error('PAYMENT_RECONCILIATION_REQUIRED');
  }
  this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('UPDATE leases SET active=? WHERE id=?').run(action==='RESUME'?1:0,id);this.db.prepare('UPDATE lease_schedules SET state=?,reason=?,next_run_at=? WHERE lease_id=?').run(action==='RESUME'?'ACTIVE':'PAUSED',action==='RESUME'?null:'USER_PAUSED',action==='RESUME'?Math.max(Date.now(),row.nextRunAt):row.nextRunAt,id);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 claimOccurrence(id:string,now:number,runId:string){return Number(this.db.prepare("UPDATE lease_schedules SET active_run_id=?,next_run_at=? WHERE lease_id=? AND state='ACTIVE' AND active_run_id IS NULL AND next_run_at<=?").run(runId,now+this.get(id).policy.schedule!.intervalSeconds*1000,id,now).changes)===1;}
 completeOccurrence(id:string,runId:string,now:number){const row=this.schedule(id);if(!row||row.activeRunId!==runId)return;const interval=this.get(id).policy.schedule!.intervalSeconds*1000;this.db.prepare('UPDATE lease_schedules SET last_run_id=?,active_run_id=NULL,next_run_at=? WHERE lease_id=? AND active_run_id=?').run(runId,row.nextRunAt<=now?now+interval:row.nextRunAt,id,runId);}
 fundedRuns(id:string){return Number(this.db.prepare("SELECT COUNT(*) AS count FROM reservations WHERE lease_id=? AND status!='RELEASED'").get(id)?.count);}
 close(){this.db.close();}
}
