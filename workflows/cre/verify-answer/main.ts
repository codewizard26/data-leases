import {
  Runner, HTTPCapability, handler, decodeJson, EVMClient, HTTPClient,
  getNetwork, blockNumber, bytesToHex, encodeCallMsg, consensusIdenticalAggregation,
  json, ok, protoBigIntToBigint,
  type Runtime, type HTTPPayload, type HTTPSendRequester,
} from '@chainlink/cre-sdk';
import { VerificationRequestSchema } from '@data-leases/contracts';
import {
  evaluateVerification, LINK_CONTRACT, METADATA_URL, type VerificationEvidence,
} from '@data-leases/cre-adapter/policy';
import {evaluateVerificationV2,POLICY_V2,type VerificationAuthority} from '@data-leases/cre-adapter/policy-v2';
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

export async function main() {
  const runner = await Runner.newRunner<WorkflowConfig>();
  // Empty authorization is permitted only for local simulation. No deployed endpoint is provided.
  await runner.run(() => [handler(new HTTPCapability().trigger({}), onRequest)]);
}
