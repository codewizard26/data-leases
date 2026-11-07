import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test,vi} from 'vitest';
import {AnswerEnvelopeSchema,type ConversationEvent} from '@data-leases/contracts';
import {EventStore} from '@data-leases/event-store';
import {MarketFeed} from '../../apps/agent-gateway/src/market-feed.js';
import {startProvider} from '../../packages/agents/src/index.js';
const fixture=JSON.parse(readFileSync(new URL('../cre/fixtures/request.json',import.meta.url),'utf8')).answer;
test('source reads stay idle until requested, run once, and preserve observations across requests',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'market-feed-')),store=new EventStore({directory});let reads=0;
 const request=vi.fn(async()=>{reads++;if(reads>2)return new Response('{}',{status:503});return new Response(JSON.stringify({answer:AnswerEnvelopeSchema.parse({...fixture,deliveredAt:new Date().toISOString(),value:reads===1?'18':'19'})}));}) as unknown as typeof fetch;
 const feed=new MarketFeed(store,[{providerId:fixture.providerId,origin:'http://127.0.0.1:4101'}],request);
 const events:ConversationEvent[]=[];
 const read=()=>new Promise<void>(resolve=>{const unsubscribe=feed.subscribe('ERC20_TOKEN_METADATA',event=>{events.push(event);if(event.status==='SOURCE_REQUEST_COMPLETED'){unsubscribe();resolve();}});});
 try{
  expect(reads).toBe(0);expect(feed.snapshot('ERC20_TOKEN_METADATA',fixture.providerId)).toBeUndefined();
  await read();expect(reads).toBe(1);
  vi.useFakeTimers();await vi.advanceTimersByTimeAsync(60000);expect(reads).toBe(1);vi.useRealTimers();
  await read();expect(reads).toBe(2);expect(events.some(event=>event.status==='SOURCE_CHANGED')).toBe(true);
  await read();expect(reads).toBe(3);expect(events.some(event=>event.status==='SOURCE_UNAVAILABLE')).toBe(true);
  expect(feed.snapshot('ERC20_TOKEN_METADATA',fixture.providerId)?.value).toBe('19');
  expect(events.filter(event=>event.status==='SOURCE_REQUEST_COMPLETED')).toHaveLength(3);
  expect(new Set(events.map(event=>event.eventId)).size).toBe(events.length);
  expect(store.list(events[0]!.sessionId)).toHaveLength(events.length);
 }finally{vi.useRealTimers();await feed.close();await store.close();rmSync(directory,{recursive:true,force:true});}
});
test('a source request contacts only the explicitly selected providers',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'market-selected-')),store=new EventStore({directory});const urls:string[]=[];
 const request=vi.fn(async(url:unknown)=>{urls.push(String(url));return new Response('{}',{status:503});}) as unknown as typeof fetch;
 const feed=new MarketFeed(store,[{providerId:'provider-a',origin:'http://127.0.0.1:4101'},{providerId:'provider-b',origin:'http://127.0.0.1:4102'}],request);
 try{await new Promise<void>(resolve=>{const unsubscribe=feed.subscribe('ERC20_TOKEN_METADATA',event=>{if(event.status==='SOURCE_REQUEST_COMPLETED'){unsubscribe();resolve();}},['provider-b']);});expect(urls).toEqual(['http://127.0.0.1:4102/public-observations/ERC20_TOKEN_METADATA']);}
 finally{await feed.close();await store.close();rmSync(directory,{recursive:true,force:true});}
});
test('public source endpoint caches real reads and never exposes private services',async()=>{
 let calls=0;const provider=await startProvider({port:0,providerId:'public-source',askMinor:'10',floorMinor:'1',sourceTemplates:['AAVE_V3_USDC_AVAILABLE_LIQUIDITY','PRIVATE_TREASURY_USDC_BALANCE'],async answerSource(){calls++;return {value:'123456789',sourceBlockNumber:'12',sourceBlockHash:'0x'+'ab'.repeat(32),evidenceRefs:['https://etherscan.io/block/12']};}});
 try{
  const responses=await Promise.all([1,2].map(()=>fetch(provider.baseUrl+'/public-observations/AAVE_V3_USDC_AVAILABLE_LIQUIDITY').then(response=>response.json())));
  expect(responses[0]).toMatchObject({kind:'PUBLIC_SOURCE_OBSERVATION',paymentStatus:'NOT_REQUESTED',verificationStatus:'UNVERIFIED',answer:{value:'123456789'}});expect(calls).toBe(1);
  expect(responses[0].answer.runId).toBe(responses[1].answer.runId);
  expect((await fetch(provider.baseUrl+'/public-observations/PRIVATE_TREASURY_USDC_BALANCE')).status).toBe(404);expect(calls).toBe(1);
 }finally{await provider.close();}
});
