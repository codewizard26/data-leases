import type {AnswerEnvelope} from '@data-leases/contracts';
const CONTRACT='0x514910771af9ca656af840dff83e8264ecf986ca';
/** Fixed read-only metric. The caller cannot choose a contract, method or RPC URL. */
export async function readLinkSource(answer:AnswerEnvelope,request:typeof fetch=fetch){
 if(answer.questionTemplateId!=='ERC20_TOKEN_METADATA'||answer.chainId!=='eip155:1'||answer.sourceContract?.toLowerCase()!==CONTRACT||answer.metric!=='ERC20_DECIMALS')throw new Error('UNSUPPORTED_SOURCE_METRIC');
 const endpoint=process.env.PROVIDER_ETH_RPC_URL??'https://ethereum-rpc.publicnode.com';
 const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password)throw new Error('INVALID_PROVIDER_RPC');
 const rpc=async(method:string,params:unknown[])=>{
  const response=await request(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('PROVIDER_REFERENCE_UNAVAILABLE');
  const body=await response.json() as {result?:unknown;error?:unknown};if(body.error||body.result===undefined||body.result===null)throw new Error('PROVIDER_REFERENCE_UNAVAILABLE');return body.result;
 };
 try {
  if(await rpc('eth_chainId',[])!=='0x1')throw new Error('PROVIDER_CHAIN_MISMATCH');
  const block=await rpc('eth_getBlockByNumber',['latest',false]) as {number:string;hash:string;timestamp:string};
  if(!/^0x[\da-f]+$/i.test(block.number)||!/^0x[\da-f]{64}$/i.test(block.hash)||!/^0x[\da-f]+$/i.test(block.timestamp))throw new Error('PROVIDER_REFERENCE_INVALID');
  const age=Date.now()-Number(BigInt(block.timestamp))*1000;if(age< -5000||age>60000)throw new Error('PROVIDER_REFERENCE_STALE');
  const value=await rpc('eth_call',[{to:CONTRACT,data:'0x313ce567'},block.number]);
  if(typeof value!=='string'||!/^0x[\da-f]{64}$/i.test(value)||BigInt(value)>255n)throw new Error('PROVIDER_REFERENCE_INVALID');
  const after=await rpc('eth_getBlockByNumber',[block.number,false]) as {hash?:string};if(after.hash?.toLowerCase()!==block.hash.toLowerCase())throw new Error('PROVIDER_BLOCK_CHANGED');
  return {value:BigInt(value).toString(),sourceBlockNumber:BigInt(block.number).toString(),sourceBlockHash:block.hash,evidenceRefs:['https://etherscan.io/block/'+BigInt(block.number).toString()]};
 } catch(error){if(error instanceof Error&&/^PROVIDER_[A-Z_]+$/.test(error.message))throw error;throw new Error('PROVIDER_REFERENCE_UNAVAILABLE');}
}
