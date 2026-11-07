import {
  Runner, HTTPCapability, handler, decodeJson, EVMClient, HTTPClient,
  getNetwork, blockNumber, bytesToHex, bytesToBase64, encodeCallMsg, consensusIdenticalAggregation,
  json, ok, protoBigIntToBigint,
  type Runtime, type HTTPPayload, type HTTPSendRequester,
} from '@chainlink/cre-sdk';
import { VerificationRequestSchema } from '@data-leases/contracts';
import {
  evaluateVerification, LINK_CONTRACT, METADATA_URL, type VerificationEvidence,
} from '@data-leases/cre-adapter/policy';
import {evaluateVerificationV2,POLICY_V2,type VerificationAuthority} from '@data-leases/cre-adapter/policy-v2';
import {readPlan,decodeReadPlan,REFERENCE_RPC_URL} from '@data-leases/cre-adapter/read-plans';
import {evaluateServiceVerification,type ServiceEvidence} from '@data-leases/cre-adapter/services';
import { requestDigest } from '@data-leases/cre-adapter/digest';

const UNAVAILABLE_METADATA_URL='https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/data-leases-unavailable-reference.json';
interface WorkflowConfig extends VerificationAuthority {referenceScenario?:'normal'|'unavailable'}
function fetchMetadata(sender: HTTPSendRequester,referenceUrl:string): string {
  const response = sender.sendRequest({ url: referenceUrl, method: 'GET', timeout: '8s' }).result();
  if (!ok(response) || response.body.length > 1_000_000) throw new Error('HTTP_REFERENCE_UNAVAILABLE');
  const data: unknown = json(response);
  if (!Array.isArray(data)) throw new Error('HTTP_REFERENCE_INVALID');
  const token: unknown = data.find((t: unknown) => typeof t === 'object' && t !== null &&
    'address' in t && typeof t.address === 'string' && t.address.toLowerCase() === LINK_CONTRACT &&
    'chainId' in t && t.chainId === 1);
  if (typeof token !== 'object' || token === null || !('decimals' in token) ||
    typeof token.decimals !== 'number' || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255) throw new Error('HTTP_METADATA_MISSING');
  // Consensus covers just the comparable field, rather than unrelated mutable token metadata.
  return String(token.decimals);
}

function onRequest(runtime: Runtime<WorkflowConfig>, payload: HTTPPayload): string {
  if (payload.input.length > 32_768) throw new Error('REQUEST_TOO_LARGE');
  const request = VerificationRequestSchema.parse(decodeJson(payload.input));
  runtime.log(`DATA_LEASES_REQUEST_SHA256:${requestDigest(request)}`);
  if(request.policy.policyId!==POLICY_V2&&(request.questionTemplateId!=='ERC20_TOKEN_METADATA'||request.answer.demoTrustMode==='SIGNED_PROVIDER'))return verifyService(runtime,request);
  const evidence: VerificationEvidence = {};
  const a = request.answer;
  // Never use provider-supplied addresses, chain names or URLs as capability destinations.
  if (a.chainId === 'eip155:1' && a.sourceContract?.toLowerCase() === LINK_CONTRACT && a.sourceBlockNumber) {
    try {
      const network = getNetwork({ chainFamily: 'evm', chainSelectorName: 'ethereum-mainnet', isTestnet: false });
      if (!network) throw new Error('NETWORK_UNAVAILABLE');
      const evm = new EVMClient(network.chainSelector.selector);
      const height = blockNumber(a.sourceBlockNumber);
      const header = evm.headerByNumber(runtime, { blockNumber: height }).result().header;
      if (!header?.blockNumber) throw new Error('HEADER_UNAVAILABLE');
      const result = evm.callContract(runtime, {
        call: encodeCallMsg({ from: '0x0000000000000000000000000000000000000000', to: LINK_CONTRACT, data: '0x313ce567' }),
        blockNumber: height,
      }).result();
      if (result.data.length !== 32) throw new Error('INVALID_ABI_RESPONSE');
      // Re-read the header to detect a block remap during the state read.
      const after = evm.headerByNumber(runtime, { blockNumber: height }).result().header;
      if (!after || bytesToHex(after.hash) !== bytesToHex(header.hash)) throw new Error('BLOCK_CHANGED');
      evidence.evm = { chainId: 'eip155:1', contract: LINK_CONTRACT,
        blockNumber: protoBigIntToBigint(header.blockNumber).toString(), blockHash: bytesToHex(header.hash),
        blockTimestamp: new Date(Number(header.timestamp) * 1000).toISOString(), value: BigInt(bytesToHex(result.data)).toString() };
    } catch { runtime.log('EVM_REFERENCE_UNAVAILABLE'); }
  }
  try {
    const decimals = new HTTPClient().sendRequest(runtime, fetchMetadata, consensusIdenticalAggregation<string>())(runtime.config.referenceScenario==='unavailable'?UNAVAILABLE_METADATA_URL:METADATA_URL).result();
    evidence.http = { chainId: 'eip155:1', contract: LINK_CONTRACT, decimals, url: METADATA_URL };
  } catch { runtime.log('HTTP_REFERENCE_UNAVAILABLE'); }
  const result = request.policy.policyId===POLICY_V2?evaluateVerificationV2(request,evidence,'CRE_CLI_SIMULATION',runtime.now().toISOString(),runtime.config):evaluateVerification(request, evidence, 'CRE_CLI_SIMULATION', runtime.now().toISOString());
  runtime.log(`DATA_LEASES_RESULT_STATUS:${result.status}`);
  // User logs can be dropped at shutdown. Bind the request in the authoritative callback return.
  return JSON.stringify({ requestSha256: requestDigest(request), result });
}


/** Public HTTP RPC and CRE EVM capabilities read the same fixed calls at the claimed block. */
function verifyService(runtime:Runtime<WorkflowConfig>,request:ReturnType<typeof VerificationRequestSchema.parse>):string {
 const plan=readPlan(request.questionTemplateId),a=request.answer,evidence:ServiceEvidence={};
 if(plan&&a.chainId==='eip155:1'&&a.sourceBlockNumber&&/^\d{1,16}$/.test(a.sourceBlockNumber)){
  try{
   const network=getNetwork({chainFamily:'evm',chainSelectorName:'ethereum-mainnet',isTestnet:false});if(!network)throw new Error('NETWORK_UNAVAILABLE');
   const evm=new EVMClient(network.chainSelector.selector),height=blockNumber(a.sourceBlockNumber);
   const header=evm.headerByNumber(runtime,{blockNumber:height}).result().header;if(!header?.blockNumber)throw new Error('HEADER_UNAVAILABLE');
   const values=plan.calls.map(call=>bytesToHex(evm.callContract(runtime,{call:encodeCallMsg({from:'0x0000000000000000000000000000000000000000',to:call.to as `0x${string}`,data:call.data as `0x${string}`}),blockNumber:height}).result().data));
   const after=evm.headerByNumber(runtime,{blockNumber:height}).result().header;if(!after||bytesToHex(after.hash)!==bytesToHex(header.hash))throw new Error('BLOCK_CHANGED');
   evidence.evm={chainId:'eip155:1',contract:plan.contract,blockNumber:protoBigIntToBigint(header.blockNumber).toString(),blockHash:bytesToHex(header.hash),blockTimestamp:new Date(Number(header.timestamp)*1000).toISOString(),value:decodeReadPlan(plan,values)};
  }catch{runtime.log('SERVICE_EVM_REFERENCE_UNAVAILABLE');}
  try{
   const observed=new HTTPClient().sendRequest(runtime,fetchRpcReference,consensusIdenticalAggregation<string>())({id:request.questionTemplateId,block:a.sourceBlockNumber}).result();
   evidence.http=JSON.parse(observed);
  }catch(error){const message=error instanceof Error?error.message:'';runtime.log(/^HTTP_REFERENCE_(STATUS_[0-9]{3}|RPC_[0-9-]+|INVALID|UNAVAILABLE)$/.test(message)?message:'SERVICE_HTTP_REFERENCE_UNAVAILABLE');}
 }
  const result=evaluateServiceVerification(request,evidence,'CRE_CLI_SIMULATION',runtime.now().toISOString(),runtime.config);
 runtime.log(`DATA_LEASES_RESULT_STATUS:${result.status}`);
 return JSON.stringify({requestSha256:requestDigest(request),result});
}
function fetchRpcReference(sender:HTTPSendRequester,input:{id:string;block:string}):string{
 const plan=readPlan(input.id);if(!plan)throw new Error('UNSUPPORTED_SERVICE');
 const rpc=(method:string,params:unknown[])=>{
  const response=sender.sendRequest({url:REFERENCE_RPC_URL,method:'POST',headers:{'Content-Type':'application/json'},body:bytesToBase64(new TextEncoder().encode(JSON.stringify({jsonrpc:'2.0',id:1,method,params}))),timeout:'8s'}).result();
  if(!ok(response))throw new Error('HTTP_REFERENCE_STATUS_'+response.statusCode);if(response.body.length>240000)throw new Error('HTTP_REFERENCE_INVALID');
  const data=json(response) as {result?:unknown;error?:unknown};if(data.error)throw new Error('HTTP_REFERENCE_RPC_'+String((data.error as {code?:number}).code??0));if(data.result==null)throw new Error('HTTP_REFERENCE_UNAVAILABLE');return data.result;
 };
 const height='0x'+BigInt(input.block).toString(16);
 if(rpc('eth_chainId',[])!=='0x1')throw new Error('WRONG_CHAIN');
 const header=rpc('eth_getBlockByNumber',[height,false]) as {number:string;hash:string;timestamp:string};
 const values=plan.calls.map(call=>rpc('eth_call',[call,height]) as string);
 const after=rpc('eth_getBlockByNumber',[height,false]) as {hash:string};if(after.hash!==header.hash)throw new Error('BLOCK_CHANGED');
 return JSON.stringify({chainId:'eip155:1',contract:plan.contract,blockNumber:BigInt(header.number).toString(),blockHash:header.hash,blockTimestamp:new Date(Number(BigInt(header.timestamp))*1000).toISOString(),value:decodeReadPlan(plan,values)});
}

export async function main() {
  const runner = await Runner.newRunner<WorkflowConfig>();
  // Empty authorization is permitted only for local simulation. No deployed endpoint is provided.
  await runner.run(() => [handler(new HTTPCapability().trigger({}), onRequest)]);
}
