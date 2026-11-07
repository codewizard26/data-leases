import {afterEach,expect,test,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {VerificationRequestSchema} from '@data-leases/contracts';
import {readLinkSource} from '../../apps/provider-agent/src/link-source.js';
const answer=VerificationRequestSchema.parse(JSON.parse(readFileSync(new URL('../cre/fixtures/request.json',import.meta.url),'utf8'))).answer;
afterEach(()=>vi.unstubAllEnvs());
function rpc(options:{chain?:string;changed?:boolean;age?:number;value?:string}={}){
 const calls:{method:string;params:unknown[]}[]=[];const hash='0x'+'ab'.repeat(32);
 const request=vi.fn(async(_url:unknown,init?:RequestInit)=>{const call=JSON.parse(String(init?.body));calls.push(call);let result:unknown;
 if(call.method==='eth_chainId')result=options.chain??'0x1';
 else if(call.method==='eth_call')result=options.value??'0x'+(18).toString(16).padStart(64,'0');
 else result={number:'0x123',hash:options.changed&&call.params[0]!=='latest'?'0x'+'cd'.repeat(32):hash,timestamp:'0x'+Math.floor((Date.now()-(options.age??0))/1000).toString(16)};
 return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result}));});return {calls,request:request as unknown as typeof fetch,hash};
}
test('provider pins decimals read to a recent Ethereum block and checks the header twice',async()=>{const f=rpc();const result=await readLinkSource(answer,f.request);expect(result).toMatchObject({value:'18',sourceBlockNumber:'291',sourceBlockHash:f.hash});expect(f.calls.find(call=>call.method==='eth_call')?.params).toEqual([{to:answer.sourceContract,data:'0x313ce567'},'0x123']);expect(JSON.stringify(result)).not.toContain('publicnode');});
test('provider rejects wrong chain, stale block, reorg and invalid decimal units',async()=>{for(const options of [{chain:'0x2'},{age:120000},{changed:true},{value:'0x'+(256).toString(16).padStart(64,'0')}])await expect(readLinkSource(answer,rpc(options).request)).rejects.toThrow(/^PROVIDER_/);});
test('source unavailable never creates a synthetic fallback or leaks RPC credentials',async()=>{vi.stubEnv('PROVIDER_ETH_RPC_URL','https://rpc.example/private-token');await expect(readLinkSource(answer,vi.fn(async()=>{throw Error('private-token');}) as typeof fetch)).rejects.toThrow('PROVIDER_REFERENCE_UNAVAILABLE');const f=rpc();await expect(readLinkSource({...answer,sourceContract:'0x'+'00'.repeat(20)},f.request)).rejects.toThrow('UNSUPPORTED_SOURCE_METRIC');expect(f.calls).toHaveLength(0);});
