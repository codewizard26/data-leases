import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import * as store from '../src/index.js';
const directories: string[] = [];
function directory() { const value=mkdtempSync(join(tmpdir(),'data-leases-events-'));directories.push(value);return value; }
afterEach(()=>{for(const value of directories.splice(0))rmSync(value,{recursive:true,force:true});});
function event(eventId:string,sessionId='session-1') {return {schemaVersion:'1.0.0' as const,eventId,sessionId,occurredAt:'2026-11-06T12:00:00.000Z',eventType:'ANSWER_DELIVERED' as const,actorRole:'PROVIDER_AGENT' as const,actorId:'provider-a',direction:'IN' as const,status:'DELIVERED_UNVERIFIED',payload:{value:'18',apiKey:'never-persist',nested:{authorization:'Bearer hidden'},prompt:'private buyer question',currency:'demo:USD6'}};}
function files(path:string):string[]{return readdirSync(path,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(join(path,item.name)):[join(path,item.name)]);}
test('durably assigns session sequences and deduplicates retries across restart',async()=>{
 const path=directory();const first=new store.EventStore({directory:path});
 const a=first.append(event('event-1'));expect(a.sequence).toBe(1);expect(first.append(event('event-1'))).toEqual(a);
 expect(first.append(event('event-2')).sequence).toBe(2);first.putState('run:1',{status:'AGREED'});await first.close();
 const second=new store.EventStore({directory:path});expect(second.list('session-1',1).map(row=>row.eventId)).toEqual(['event-2']);expect(second.getState('run:1')).toEqual({status:'AGREED'});expect(second.append(event('event-1'))).toEqual(a);expect(second.sessions()).toMatchObject([{sessionId:'session-1',eventCount:2,lastSequence:2}]);await second.close();
});
test('writes actual immutable Parquet with redacted structured answer payloads',async()=>{
 const path=directory();const db=new store.EventStore({directory:path});db.append(event('event-1'));db.append(event('event-2'));await db.flush();
 const sealed=files(path).filter(file=>file.endsWith('.parquet'));expect(sealed).toHaveLength(1);const bytes=readFileSync(sealed[0]!);expect(bytes.subarray(0,4).toString()).toBe('PAR1');expect(sealed[0]).toContain('event_date=2026-11-06/session_id=session-1/');
 const rows=await db.inspectParquet('session-1');expect(rows.map(row=>row.sequence)).toEqual([1,2]);expect(JSON.parse(rows[0]!.payloadJson)).toEqual({apiKey:'[REDACTED]',currency:'demo:USD6',nested:{authorization:'[REDACTED]'},prompt:'[REDACTED]',value:'18'});
 expect(JSON.stringify(rows)).not.toContain('never-persist');expect(JSON.stringify(rows)).not.toContain('private buyer question');
 db.append(event('event-3'));await Promise.all([db.flush(),db.flush()]);expect(readFileSync(sealed[0]!)).toEqual(bytes);expect((await db.inspectParquet()).map(row=>row.eventId)).toEqual(['event-1','event-2','event-3']);await db.close();
});
test('conflicting event IDs and concurrent writer owners fail explicitly',async()=>{
 const path=directory();const db=new store.EventStore({directory:path});db.append(event('event-1'));expect(()=>db.append({...event('event-1'),status:'OTHER'})).toThrow('EVENT_ID_CONFLICT');expect(()=>new store.EventStore({directory:path})).toThrow('EVENT_STORE_WRITER_ACTIVE');await db.close();
});

test('recovers committed SQLite events after a process exits without flushing',async()=>{
 const path=directory();
 const script=`import {EventStore} from ${JSON.stringify(new URL('../src/index.ts',import.meta.url).href)};const db=new EventStore({directory:${JSON.stringify(path)}});db.append(${JSON.stringify(event('crash-event'))});process.exit(0);`;
 execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',script]);
 const db=new store.EventStore({directory:path});expect(db.list('session-1')).toHaveLength(1);await db.flush();expect((await db.inspectParquet()).map(row=>row.eventId)).toEqual(['crash-event']);await db.close();
});
test('recovers rename-before-index-commit without duplicate immutable shards',async()=>{
 const path=directory();const first=new store.EventStore({directory:path});first.append(event('event-1'));await first.close();
 const sealed=files(path).find(file=>file.endsWith('.parquet'))!;const before=readFileSync(sealed);writeFileSync(`${sealed}.tmp`,'abandoned');
 const index=new DatabaseSync(join(path,'events.sqlite'));index.exec('UPDATE batches SET exported=0');index.close();
 const second=new store.EventStore({directory:path});expect(files(path).filter(file=>file.endsWith('.tmp'))).toEqual([]);await second.flush();expect(files(path).filter(file=>file.endsWith('.parquet'))).toEqual([sealed]);expect(readFileSync(sealed)).toEqual(before);expect(await second.inspectParquet()).toHaveLength(1);await second.close();
});
test('partitions batches by event date and session without making one file per event',async()=>{
 const path=directory();const db=new store.EventStore({directory:path});
 for(let index=0;index<25;index++)db.append(event(`batch-${index}`));db.append(event('another-session','session-2'));
 db.append({...event('another-day'),occurredAt:'2026-11-07T00:00:00.000Z'});await db.flush();
 expect(files(path).filter(file=>file.endsWith('.parquet'))).toHaveLength(4);expect(await db.inspectParquet()).toHaveLength(27);await db.close();
});
test('redacts camel-case private prompt and credential fields before SQLite persistence',async()=>{
 const path=directory();const db=new store.EventStore({directory:path});
 const row=db.append({...event('sensitive'),payload:{buyerPrompt:'never store question',providerPrivateKey:'never store key',bearerToken:'never store token',value:'18'}});
 expect(row.payloadJson).not.toContain('never store');await db.close();
});
test('normalizes accepted UTC timestamps so recovered Parquet batches compare exactly',async()=>{
 const path=directory();const db=new store.EventStore({directory:path});db.append({...event('short-iso'),occurredAt:'2026-11-06T12:00:00Z'});await db.close();
 const index=new DatabaseSync(join(path,'events.sqlite'));index.exec('UPDATE batches SET exported=0');index.close();
 const recovered=new store.EventStore({directory:path});await expect(recovered.flush()).resolves.toBeUndefined();await recovered.close();
});
