import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync,linkSync,unlinkSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {dirname} from 'node:path';
import type {PublicEntity,StoredEntity} from './schemas.js';
export interface PublicationJob {id:string;digest:string;record:PublicEntity;state:'PENDING'|'SIGNED'|'UNKNOWN'|'CONFIRMED'|'FAILED';rawTransaction?:`0x${string}`;transactionHash?:`0x${string}`;maximumFeeWei?:string;entity?:StoredEntity}
/** A file journal has one publisher process. Malformed or inaccessible locks fail closed. */
function acquirePublisherLock(path:string):()=>void {
 const value=JSON.stringify({pid:process.pid,token:randomUUID()});
 const temporary=path+'.'+randomUUID()+'.tmp';
 writeFileSync(temporary,value,{flag:'wx',mode:0o600});
 const descriptor=openSync(temporary,'r');try{fsyncSync(descriptor);}finally{closeSync(descriptor);}
 try {
  try{linkSync(temporary,path);}catch(error){
   if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
   const previous=readFileSync(path,'utf8');let pid:unknown;
   try{pid=(JSON.parse(previous) as {pid?:unknown}).pid;}catch{throw new Error('ARKIV_JOURNAL_BUSY');}
   if(typeof pid!=='number'||!Number.isInteger(pid)||pid<=0)throw new Error('ARKIV_JOURNAL_BUSY');
   try{process.kill(pid,0);throw new Error('ARKIV_JOURNAL_BUSY');}catch(probeError){if((probeError as NodeJS.ErrnoException).code!=='ESRCH')throw new Error('ARKIV_JOURNAL_BUSY');}
   if(readFileSync(path,'utf8')!==previous)throw new Error('ARKIV_JOURNAL_BUSY');
   unlinkSync(path);
   try{linkSync(temporary,path);}catch{throw new Error('ARKIV_JOURNAL_BUSY');}
  }
 }finally{unlinkSync(temporary);}
 return ()=>{try{if(readFileSync(path,'utf8')===value)unlinkSync(path);}catch{/* Never remove another owner's lock. */}};
}
/** Publication-only outbox. It never owns payment state or Parquet. */
export class PublicationJournal {
 private db:DatabaseSync;
 private releaseLock:(()=>void)|undefined;
 private closed=false;
 constructor(path:string){if(path!==':memory:'){mkdirSync(dirname(path),{recursive:true,mode:0o700});this.releaseLock=acquirePublisherLock(path+'.lock');}try{this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS arkiv_publications(id TEXT PRIMARY KEY,digest TEXT NOT NULL,state TEXT NOT NULL,body TEXT NOT NULL)');}catch(error){this.releaseLock?.();throw error;}}
 get(id:string):PublicationJob|undefined {const row=this.db.prepare('SELECT body FROM arkiv_publications WHERE id=?').get(id);return row?JSON.parse(String(row.body)):undefined;}
 register(job:PublicationJob){const prior=this.get(job.id);if(prior){if(prior.digest!==job.digest)throw new Error('ARKIV_PUBLICATION_ID_CONFLICT');return prior;}this.db.prepare('INSERT INTO arkiv_publications VALUES(?,?,?,?)').run(job.id,job.digest,job.state,JSON.stringify(job));return job;}
 save(job:PublicationJob){this.db.prepare('UPDATE arkiv_publications SET state=?,body=? WHERE id=?').run(job.state,JSON.stringify(job),job.id);}
 signed(id:string,raw:`0x${string}`,transactionHash:`0x${string}`,maximumFeeWei:string,totalCap:string){this.db.exec('BEGIN IMMEDIATE');try{const job=this.get(id);if(!job)throw new Error('ARKIV_JOB_NOT_FOUND');if(job.rawTransaction&&job.rawTransaction!==raw)throw new Error('ARKIV_REPLACEMENT_NOT_ALLOWED');const total=this.db.prepare('SELECT body FROM arkiv_publications WHERE id!=?').all(id).reduce((sum,row)=>sum+BigInt((JSON.parse(String(row.body)) as PublicationJob).maximumFeeWei??'0'),0n);if(total+BigInt(maximumFeeWei)>BigInt(totalCap))throw new Error('ARKIV_TOTAL_FEE_CAP_EXCEEDED');job.rawTransaction=raw;job.transactionHash=transactionHash;job.maximumFeeWei=maximumFeeWei;job.state='SIGNED';this.save(job);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}}
 pending(){return this.db.prepare("SELECT body FROM arkiv_publications WHERE state IN ('PENDING','SIGNED','UNKNOWN') ORDER BY rowid").all().map(row=>JSON.parse(String(row.body)) as PublicationJob);}
 close(){if(this.closed)return;this.closed=true;try{this.db.close();}finally{this.releaseLock?.();}}
}
