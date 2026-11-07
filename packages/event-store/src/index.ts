import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ParquetReader, ParquetSchema, ParquetWriter, type SchemaDefinition } from '@dsnp/parquetjs';
import { ConversationEventSchema, type ConversationEvent } from '@data-leases/contracts';

export type EventInput = Omit<ConversationEvent, 'sequence' | 'ingestedAt' | 'payloadJson' | 'payloadSha256'> & { payload: unknown };
export interface SessionHistory {sessionId:string;eventCount:number;lastSequence:number;updatedAt:string}
const sensitive = /^(api[_-]?key|authorization|cookie|set-cookie|password|private[_-]?key|mnemonic|seed|secret|token|access[_-]?token|refresh[_-]?token|prompt|system[_-]?prompt|messages)$/i;
/** Redact before SQLite, hashing, or Parquet. Model prompts and credentials are never analytical payloads. */
export function redactPayload(value:unknown, depth=0):unknown {
 if(depth>30)throw new Error('EVENT_PAYLOAD_TOO_DEEP');
 if(value===null||typeof value==='boolean'||typeof value==='number'){if(typeof value==='number'&&!Number.isFinite(value))throw new Error('INVALID_EVENT_PAYLOAD');return value;}
 if(typeof value==='string')return value.replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]').replace(/(?:app-sk-|sk-)[A-Za-z0-9_-]+/g,'[REDACTED]').replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[REDACTED]');
 if(Array.isArray(value))return value.map(item=>redactPayload(item,depth+1));
 if(typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){const output:Record<string,unknown>=Object.create(null);for(const key of Object.keys(value).sort()){const item=(value as Record<string,unknown>)[key];if(item!==undefined)output[key]=(sensitive.test(key)||/(prompt|password|secret|authorization|mnemonic|privatekey|apikey|bearertoken)/i.test(key.replace(/[_-]/g,'')))?'[REDACTED]':redactPayload(item,depth+1);}return output;}
 throw new Error('INVALID_EVENT_PAYLOAD');
}
function encoded(value:unknown):string {const text=JSON.stringify(redactPayload(value));if(Buffer.byteLength(text)>262144)throw new Error('EVENT_PAYLOAD_TOO_LARGE');return text;}
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const columns:Record<keyof ConversationEvent,string>={schemaVersion:'schema_version',eventId:'event_id',sessionId:'session_id',negotiationId:'negotiation_id',a2aTaskId:'a2a_task_id',runId:'run_id',sequence:'sequence',occurredAt:'occurred_at',ingestedAt:'ingested_at',eventType:'event_type',actorRole:'actor_role',actorId:'actor_id',providerId:'provider_id',direction:'direction',messageId:'message_id',status:'status',priceMinor:'price_minor',currency:'currency',payloadJson:'payload_json',payloadSha256:'payload_sha256',errorCode:'error_code'};
const optional=new Set(['negotiationId','a2aTaskId','runId','providerId','messageId','priceMinor','currency','errorCode']);
const definition:SchemaDefinition={};
for(const [key,column] of Object.entries(columns))definition[column]={type:key==='sequence'?'INT64':key==='occurredAt'||key==='ingestedAt'?'TIMESTAMP_MILLIS':'UTF8',...(optional.has(key)?{optional:true}:{})};
const parquetSchema=new ParquetSchema(definition);
function toRow(event:ConversationEvent):Record<string,unknown>{const row:Record<string,unknown>={};for(const [key,column]of Object.entries(columns)){const value=event[key as keyof ConversationEvent];if(value!==undefined)row[column]=key==='occurredAt'||key==='ingestedAt'?new Date(value as string):value;}return row;}
function fromRow(row:Record<string,unknown>):ConversationEvent{const event:Record<string,unknown>={};for(const [key,column]of Object.entries(columns)){const value=row[column];if(value!==undefined&&value!==null)event[key]=key==='occurredAt'||key==='ingestedAt'?new Date(value as string|number|Date).toISOString():key==='sequence'?Number(value):String(value);}return ConversationEventSchema.parse(event);}
function parquetFiles(path:string):string[]{if(!existsSync(path))return [];return readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?parquetFiles(join(path,entry.name)):entry.isFile()&&entry.name.endsWith('.parquet')?[join(path,entry.name)]:[]);}
async function readRows(path:string):Promise<ConversationEvent[]>{const reader=await ParquetReader.openFile(path);try{const result:ConversationEvent[]=[];const cursor=reader.getCursor();let row;while((row=await cursor.next())!=null)result.push(fromRow(row as Record<string,unknown>));return result;}finally{await reader.close();}}
interface StoredRow {body:string; input_digest:string}
interface Batch {batch_id:string;relative_path:string}

/** Single writer per directory, SQLite transactional outbox, immutable analytical files. */
export class EventStore {
 private readonly db:DatabaseSync;
 private readonly directory:string;
 private readonly lockPath:string;
 private closed=false;
 private closing=false;
 private flushChain:Promise<void>=Promise.resolve();
 constructor(options:{directory:string}){
  this.directory=resolve(options.directory);mkdirSync(this.directory,{recursive:true});this.lockPath=join(this.directory,'.writer.lock');
  if(existsSync(this.lockPath)){let alive=true;try{const pid=Number(readFileSync(this.lockPath,'utf8'));if(!Number.isInteger(pid)||pid<=0)throw new Error('INVALID_WRITER_LOCK');try{process.kill(pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')alive=false;else throw error;}}catch(error){if((error as Error).message==='INVALID_WRITER_LOCK')throw error;throw new Error('EVENT_STORE_WRITER_ACTIVE');}if(alive)throw new Error('EVENT_STORE_WRITER_ACTIVE');rmSync(this.lockPath);}
  const pendingLock=`${this.lockPath}.${process.pid}.${randomUUID()}.tmp`;const fd=openSync(pendingLock,'wx',0o600);try{writeFileSync(fd,String(process.pid));fsyncSync(fd);}finally{closeSync(fd);}try{linkSync(pendingLock,this.lockPath);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error('EVENT_STORE_WRITER_ACTIVE');throw error;}finally{rmSync(pendingLock,{force:true});}
  try{
   this.db=new DatabaseSync(join(this.directory,'events.sqlite'));
   this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS events(event_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,sequence INTEGER NOT NULL,event_date TEXT NOT NULL,body TEXT NOT NULL,input_digest TEXT NOT NULL,batch_id TEXT,UNIQUE(session_id,sequence));
    CREATE TABLE IF NOT EXISTS batches(batch_id TEXT PRIMARY KEY,relative_path TEXT NOT NULL,exported INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
   const cleanup=(path:string)=>{if(!existsSync(path))return;for(const entry of readdirSync(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isDirectory())cleanup(file);else if(entry.isFile()&&entry.name.endsWith('.parquet.tmp'))rmSync(file);}};cleanup(join(this.directory,'conversation_events'));
  }catch(error){rmSync(this.lockPath,{force:true});throw error;}
 }
 private open(){if(this.closed||this.closing)throw new Error('EVENT_STORE_CLOSED');}
 append(input:EventInput):ConversationEvent{
  this.open();const {payload,...fields}=input;const payloadJson=encoded(payload);const parsed=ConversationEventSchema.parse({...fields,sequence:1,ingestedAt:'2000-01-01T00:00:00.000Z',payloadJson,payloadSha256:hash(payloadJson)});const normalized={...parsed,occurredAt:new Date(parsed.occurredAt).toISOString()};
  const digest=hash(JSON.stringify(normalized));
  this.db.exec('BEGIN IMMEDIATE');try{
   const prior=this.db.prepare('SELECT body,input_digest FROM events WHERE event_id=?').get(normalized.eventId) as StoredRow|undefined;
   if(prior){if(prior.input_digest!==digest)throw new Error('EVENT_ID_CONFLICT');this.db.exec('COMMIT');return ConversationEventSchema.parse(JSON.parse(prior.body));}
   const row=this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM events WHERE session_id=?').get(normalized.sessionId) as {next:number};
   const event=ConversationEventSchema.parse({...normalized,sequence:Number(row.next),ingestedAt:new Date().toISOString()});
   this.db.prepare('INSERT INTO events(event_id,session_id,sequence,event_date,body,input_digest) VALUES(?,?,?,?,?,?)').run(event.eventId,event.sessionId,event.sequence,event.occurredAt.slice(0,10),JSON.stringify(event),digest);this.db.exec('COMMIT');return event;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 list(sessionId:string,afterSequence=0):ConversationEvent[]{this.open();if(!Number.isSafeInteger(afterSequence)||afterSequence<0)throw new Error('INVALID_EVENT_CURSOR');return (this.db.prepare('SELECT body FROM events WHERE session_id=? AND sequence>? ORDER BY sequence').all(sessionId,afterSequence)as {body:string}[]).map(row=>ConversationEventSchema.parse(JSON.parse(row.body)));}
 sessions():SessionHistory[]{this.open();return this.db.prepare('SELECT session_id AS sessionId,COUNT(*) AS eventCount,MAX(sequence) AS lastSequence,MAX(json_extract(body,\'$.ingestedAt\')) AS updatedAt FROM events GROUP BY session_id ORDER BY updatedAt DESC').all() as unknown as SessionHistory[];}
 putState(key:string,value:unknown):void{this.open();this.db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,encoded(value));}
 getState<T=unknown>(key:string):T|null{this.open();const row=this.db.prepare('SELECT value FROM state WHERE key=?').get(key)as {value:string}|undefined;return row?JSON.parse(row.value)as T:null;}
 flush():Promise<void>{if(this.closed)return Promise.reject(new Error('EVENT_STORE_CLOSED'));const next=this.flushChain.catch(()=>{}).then(()=>this.exportBatches());this.flushChain=next;return next;}
 private allocateBatch():Batch|undefined{
  this.db.exec('BEGIN IMMEDIATE');try{
   const group=this.db.prepare('SELECT event_date,session_id FROM events WHERE batch_id IS NULL ORDER BY event_date,session_id,sequence LIMIT 1').get()as {event_date:string;session_id:string}|undefined;
   if(!group){this.db.exec('COMMIT');return;}
   const ids=this.db.prepare('SELECT event_id FROM events WHERE batch_id IS NULL AND event_date=? AND session_id=? ORDER BY sequence LIMIT 20').all(group.event_date,group.session_id)as {event_id:string}[];
   const batch_id=randomUUID();const relative_path=join('conversation_events',`event_date=${group.event_date}`,`session_id=${encodeURIComponent(group.session_id)}`,`part-${batch_id}.parquet`);
   this.db.prepare('INSERT INTO batches(batch_id,relative_path) VALUES(?,?)').run(batch_id,relative_path);const update=this.db.prepare('UPDATE events SET batch_id=? WHERE event_id=?');for(const row of ids)update.run(batch_id,row.event_id);this.db.exec('COMMIT');return {batch_id,relative_path};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 private async exportBatches():Promise<void>{
  while(true){const batch=this.db.prepare('SELECT batch_id,relative_path FROM batches WHERE exported=0 ORDER BY rowid LIMIT 1').get()as Batch|undefined??this.allocateBatch();if(!batch)return;
   const events=(this.db.prepare('SELECT body FROM events WHERE batch_id=? ORDER BY sequence').all(batch.batch_id)as {body:string}[]).map(row=>ConversationEventSchema.parse(JSON.parse(row.body)));
   const file=join(this.directory,batch.relative_path);mkdirSync(dirname(file),{recursive:true});
   if(existsSync(file)){const rows=await readRows(file);if(JSON.stringify(rows)!==JSON.stringify(events))throw new Error('PARQUET_BATCH_CONTENT_MISMATCH');}
   else{const temporary=`${file}.tmp`;rmSync(temporary,{force:true});const writer=await ParquetWriter.openFile(parquetSchema,temporary);try{for(const event of events)await writer.appendRow(toRow(event));}finally{await writer.close();}const fd=openSync(temporary,'r');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(temporary,file);const parent=openSync(dirname(file),'r');try{fsyncSync(parent);}finally{closeSync(parent);}}
   this.db.prepare('UPDATE batches SET exported=1 WHERE batch_id=?').run(batch.batch_id);
  }
 }
 async inspectParquet(sessionId?:string):Promise<ConversationEvent[]>{if(this.closed)throw new Error('EVENT_STORE_CLOSED');return inspectParquetDataset(this.directory,sessionId);}
 async close():Promise<void>{if(this.closed)return;if(this.closing){await this.flushChain;return;}this.closing=true;try{await this.flush();this.db.close();this.closed=true;rmSync(this.lockPath,{force:true});}finally{this.closing=false;}}
}

/** Read-only inspection can run while the gateway owns the SQLite writer lock. */
export async function inspectParquetDataset(directory:string,sessionId?:string):Promise<ConversationEvent[]>{const events:ConversationEvent[]=[];const ids=new Set<string>();for(const file of parquetFiles(join(resolve(directory),'conversation_events'))){for(const event of await readRows(file)){if(sessionId&&event.sessionId!==sessionId)continue;if(ids.has(event.eventId))throw new Error('DUPLICATE_PARQUET_EVENT');if(hash(event.payloadJson)!==event.payloadSha256)throw new Error('PARQUET_PAYLOAD_HASH_MISMATCH');ids.add(event.eventId);events.push(event);}}return events.sort((a,b)=>a.sessionId.localeCompare(b.sessionId)||a.sequence-b.sequence);}
