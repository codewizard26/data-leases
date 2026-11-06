import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {z} from 'zod';
export const LeasePolicySchema=z.object({leaseId:z.string().uuid(),questionTemplateId:z.string().min(1),currency:z.literal('hedera:testnet/HBAR'),providerIds:z.array(z.string().min(1)).min(1),perRequestTinybars:z.string().regex(/^[1-9][0-9]{0,18}$/),totalTinybars:z.string().regex(/^[1-9][0-9]{0,18}$/),expiresAt:z.string().datetime(),maxAgeSeconds:z.number().int().min(1).max(86400),maxRounds:z.number().int().min(2).max(3),paymentsAuthorized:z.boolean().default(true)}).strict();
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
  this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS leases(id TEXT PRIMARY KEY,policy TEXT NOT NULL,signature TEXT NOT NULL,active INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS reservations(run_id TEXT PRIMARY KEY,lease_id TEXT NOT NULL,amount TEXT NOT NULL,status TEXT NOT NULL);CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,value TEXT NOT NULL)');
 }
 authorize(input:LeasePolicy){const policy=LeasePolicySchema.parse(input);if(Date.parse(policy.expiresAt)<=Date.now()||BigInt(policy.perRequestTinybars)>BigInt(policy.totalTinybars))throw new Error('INVALID_LEASE_POLICY');const value=JSON.stringify(policy);const signature=sign(null,Buffer.from(value),this.privateKey).toString('base64');this.db.prepare('INSERT INTO leases VALUES(?,?,?,1)').run(policy.leaseId,value,signature);return this.get(policy.leaseId);}
 get(id:string){const row=this.db.prepare('SELECT * FROM leases WHERE id=?').get(id);if(!row)throw new Error('LEASE_NOT_FOUND');const value=String(row.policy);if(!verify(null,Buffer.from(value),this.publicKey,Buffer.from(String(row.signature),'base64')))throw new Error('POLICY_SIGNATURE_INVALID');const policy=LeasePolicySchema.parse(JSON.parse(value));const held=this.db.prepare("SELECT amount FROM reservations WHERE lease_id=? AND status!='RELEASED'").all(id).reduce((sum,r)=>sum+BigInt(String(r.amount)),0n);return {policy,signature:String(row.signature),active:Boolean(row.active),reservedTinybars:held.toString(),remainingTinybars:(BigInt(policy.totalTinybars)-held).toString()};}
 cancel(id:string){this.get(id);this.db.prepare('UPDATE leases SET active=0 WHERE id=?').run(id);}
 reserve(leaseId:string,runId:string,providerId:string,amount:string){this.db.exec('BEGIN IMMEDIATE');try{const lease=this.get(leaseId);if(!lease.active||Date.parse(lease.policy.expiresAt)<=Date.now())throw new Error('LEASE_EXPIRED_OR_CANCELLED');if(!lease.policy.providerIds.includes(providerId)||!/^[1-9][0-9]*$/.test(amount)||BigInt(amount)>BigInt(lease.policy.perRequestTinybars)||BigInt(amount)>BigInt(lease.remainingTinybars))throw new Error('LEASE_BUDGET_EXCEEDED');this.db.prepare('INSERT INTO reservations VALUES(?,?,?,?)').run(runId,leaseId,amount,'RESERVED');this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
 mark(runId:string,status:'SETTLED'|'UNKNOWN'|'RELEASED'){this.db.prepare('UPDATE reservations SET status=? WHERE run_id=?').run(status,runId);}
 claim(runId:string,value:unknown){return Number(this.db.prepare('INSERT OR IGNORE INTO runs VALUES(?,?)').run(runId,JSON.stringify(value)).changes)===1;}
 save(runId:string,value:unknown){this.db.prepare('UPDATE runs SET value=? WHERE id=?').run(JSON.stringify(value),runId);}
 run(runId:string):unknown{const r=this.db.prepare('SELECT value FROM runs WHERE id=?').get(runId);return r?JSON.parse(String(r.value)):undefined;}
 runs():unknown[]{return this.db.prepare('SELECT value FROM runs ORDER BY rowid DESC LIMIT 100').all().map(r=>JSON.parse(String(r.value)));}
 close(){this.db.close();}
}
