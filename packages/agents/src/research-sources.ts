import {z} from 'zod';
import {ResearchEvidenceSchema,researchTask,type ResearchEvidence} from '@data-leases/contracts';
const S=10n**12n;
function dec(value:string){if(!/^-?\d+(\.\d+)?$/.test(value)||value.length>80)throw Error('INVALID_MARKET_DECIMAL');const negative=value.startsWith('-'),[whole,fraction='']=(negative?value.slice(1):value).split('.');return (negative?-1n:1n)*(BigInt(whole!)*S+BigInt((fraction+'0'.repeat(12)).slice(0,12)));}
function fmt(value:bigint){const negative=value<0n,raw=(negative?-value:value).toString().padStart(13,'0'),fraction=raw.slice(-12).replace(/0+$/,'');return (negative?'-':'')+raw.slice(0,-12)+(fraction?'.'+fraction:'');}
async function readJson(url:ResearchEvidence['facts'][number]['sourceUrl'],fetcher:typeof fetch,body?:unknown,maxBytes=4*1024*1024){
 const response=await fetcher(url,{method:body?'POST':'GET',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok||!response.body)throw Error('RESEARCH_SOURCE_UNAVAILABLE');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw Error('RESEARCH_SOURCE_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel();}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;}catch{throw Error('INVALID_RESEARCH_RESPONSE');}
}
/** Fixed public endpoints only. No user URL, private wallet data, order placement or model-directed fetch. */
export async function fetchResearchEvidence(taskId:string,fetcher:typeof fetch=fetch):Promise<ResearchEvidence>{
 const task=researchTask(taskId);if(!task)throw Error('UNKNOWN_RESEARCH_TASK');const facts:ResearchEvidence['facts']=[],limitations:string[]=[];
 const add=(id:string,label:string,value:string,unit:string,sourceUrl:ResearchEvidence['facts'][number]['sourceUrl'])=>facts.push({id,label,value,unit,sourceUrl});let scope='';
 if(task.connector==='YIELDS'){
  const url='https://yields.llama.fi/pools' as const,raw=await readJson(url,fetcher,undefined,16*1024*1024);
  const data=z.object({status:z.literal('success'),data:z.array(z.unknown()).max(100000)}).parse(raw);
  const pool=z.object({chain:z.literal('Ethereum'),stablecoin:z.literal(true),project:z.string().regex(/^[a-z0-9-]{1,60}$/),symbol:z.string().regex(/^[A-Za-z0-9_.:/ -]{1,60}$/),tvlUsd:z.number().finite().min(10000000),apy:z.number().finite().min(0).max(500),apyBase:z.number().finite().min(0).max(500),apyReward:z.number().finite().min(0).max(500).nullable().optional()});
  const eligible=data.data.flatMap(value=>{const p=pool.safeParse(value);return p.success?[p.data]:[];}).sort((a,b)=>b.apyBase-a.apyBase),projects=new Set<string>();
  const selected=eligible.filter(p=>{if(projects.has(p.project))return false;projects.add(p.project);return true;}).slice(0,4);
  if(selected.length<2)throw Error('INSUFFICIENT_YIELD_COMPARISON');
  for(const [index,p] of selected.entries()){const prefix='pool_'+index,label=p.project+' / '+p.symbol;add(prefix+'_base',label+' · base APY',p.apyBase.toFixed(6),'%',url);add(prefix+'_reward',label+' · reward APY',(p.apyReward??0).toFixed(6),'%',url);add(prefix+'_total',label+' · total APY',p.apy.toFixed(6),'%',url);add(prefix+'_tvl',label+' · reported TVL',p.tvlUsd.toFixed(2),'USD',url);}
  scope='Ethereum pools flagged stablecoin by DeFiLlama, reported TVL at least USD ten million; up to four distinct projects ranked by base APY.';
  limitations.push('Selection is a bounded screen, not a complete market ranking. Stablecoin classification and reported TVL do not establish principal safety, withdrawal availability or asset equivalence.','DeFiLlama yield data is typically updated hourly; retrieval time is not proof of a new pool observation. APY is variable and not a forward return guarantee.','No audits, redemption rules, token incentives expiry, wallet eligibility, gas, bridge costs or net realized returns were independently checked.');
 }else if(task.connector==='FUNDING'){
  const url='https://api.hyperliquid.xyz/info' as const,raw=await readJson(url,fetcher,{type:'metaAndAssetCtxs'});
  const [meta,contexts]=z.tuple([z.object({universe:z.array(z.object({name:z.string()}))}),z.array(z.unknown())]).parse(raw);
  for(const name of ['BTC','ETH','SOL']){const index=meta.universe.findIndex(x=>x.name===name);if(index<0)throw Error('PERP_MARKET_UNAVAILABLE');const c=z.object({funding:z.string(),markPx:z.string(),oraclePx:z.string(),openInterest:z.string()}).parse(contexts[index]);const mark=dec(c.markPx),oracle=dec(c.oraclePx),oi=dec(c.openInterest);if(mark<=0n||oracle<=0n||oi<0n)throw Error('INVALID_PERP_CONTEXT');
   add(name+'_funding',name+' current hourly funding',fmt(dec(c.funding)*100n),'% / hour',url);add(name+'_basis',name+' mark minus oracle',fmt((mark-oracle)*10000n*S/oracle),'basis points',url);add(name+'_mark',name+' mark price',fmt(mark),'USD reference',url);add(name+'_oi',name+' open-interest notional at mark',fmt(oi*mark/S),'USD reference',url);
  }
  scope='Hyperliquid BTC, ETH and SOL perpetual contexts from one public API snapshot.';limitations.push('One venue and one snapshot only. This is not cross-venue arbitrage research or a historical change signal.','Funding is the current hourly rate, not a guaranteed daily or annual return. Positive funding means longs pay shorts on this venue.','Mark–oracle divergence is not an executable spot/perpetual basis. Open interest alone does not establish net directional positioning or crowding.','No trading fees, margin, liquidations, order-book depth, hedging costs or wallet exposures were included.');
 }else{
  const coinbase='https://api.exchange.coinbase.com/products/ETH-USD/book?level=2' as const,gemini='https://api.gemini.com/v1/book/ethusd?limit_bids=100&limit_asks=100' as const;
  const [cb,gm]=await Promise.all([readJson(coinbase,fetcher),readJson(gemini,fetcher)]);
  const cbBook=z.object({bids:z.array(z.array(z.union([z.string(),z.number()])).min(2)),asks:z.array(z.array(z.union([z.string(),z.number()])).min(2))}).parse(cb),gmBook=z.object({bids:z.array(z.object({price:z.string(),amount:z.string()})),asks:z.array(z.object({price:z.string(),amount:z.string()}))}).parse(gm);
  const books=[{name:'Coinbase',url:coinbase,bids:cbBook.bids.map(x=>[String(x[0]),String(x[1])]),asks:cbBook.asks.map(x=>[String(x[0]),String(x[1])])},{name:'Gemini',url:gemini,bids:gmBook.bids.map(x=>[x.price,x.amount]),asks:gmBook.asks.map(x=>[x.price,x.amount])}];
  for(const book of books){const levels=(rows:string[][],descending:boolean)=>rows.map(row=>({price:dec(row[0]!),size:dec(row[1]!)})).filter(x=>x.price>0n&&x.size>0n).sort((a,b)=>a.price===b.price?0:(a.price<b.price?-1:1)*(descending?-1:1));const bids=levels(book.bids,true),asks=levels(book.asks,false);if(!bids.length||!asks.length||bids[0]!.price>=asks[0]!.price)throw Error('INVALID_ORDER_BOOK');const bid=bids[0]!.price,ask=asks[0]!.price,mid=(bid+ask)/2n;
   const depth=(rows:typeof bids)=>rows.filter(x=>(x.price>mid?x.price-mid:mid-x.price)*10000n<=mid*10n).reduce((sum,x)=>sum+x.price*x.size/S,0n);
   const target=100000n*S;let remaining=target,quantity=0n,spent=0n;for(const level of asks){if(remaining<=0n)break;const capacity=level.price*level.size/S,take=capacity<remaining?level.size:remaining*S/level.price,cost=take*level.price/S;quantity+=take;spent+=cost;remaining-=cost;}
   add(book.name+'_spread',book.name+' ETH/USD bid–ask spread',fmt((ask-bid)*10000n*S/mid),'basis points',book.url);add(book.name+'_bid',book.name+' best bid',fmt(bid),'USD',book.url);add(book.name+'_ask',book.name+' best ask',fmt(ask),'USD',book.url);add(book.name+'_bid_depth',book.name+' displayed bid notional within ten basis points',fmt(depth(bids)),'USD',book.url);add(book.name+'_ask_depth',book.name+' displayed ask notional within ten basis points',fmt(depth(asks)),'USD',book.url);add(book.name+'_buy_vwap',book.name+' snapshot buy VWAP for target USD one hundred thousand',quantity?fmt(spent*S/quantity):'unavailable','USD',book.url);add(book.name+'_buy_coverage',book.name+' target buy notional covered by sampled asks',fmt(spent*100n*S/target),'%',book.url);
  }
  scope='ETH/USD public limit-order books on Coinbase and Gemini; displayed depth within ten basis points and a fixed USD one hundred thousand buy simulation.';limitations.push('Books were retrieved independently, not atomically. Gemini is limited to the requested hundred levels; reported depth is bounded by the returned snapshots.','Displayed orders may cancel or change before execution. Snapshot VWAP is an estimate, not a firm quote or execution guarantee.','No fees, latency, rebates, queue position, hidden liquidity, account access or transfer constraints were included. A quoted price gap is not guaranteed arbitrage profit.');
 }
 return ResearchEvidenceSchema.parse({taskId,retrievedAt:new Date().toISOString(),scope,facts,limitations});
}
