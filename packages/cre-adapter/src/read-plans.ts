import {keccak_256} from '@noble/hashes/sha3.js';
import {bytesToHex} from '@noble/hashes/utils.js';
export interface ReadCall {to:string;data:string}
export interface ReadPlan {calls:ReadCall[];kind:'DECIMALS'|'LIQUIDITY'|'DEBT'|'UTILIZATION'|'LTV'|'THRESHOLD'|'SUPPLY_APY'|'BORROW_APY';contract:string}
const USDC='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',WETH='0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const DATA='0x0a16f2fcc0d44fae41cc54e079281d84a363becd',POOL='0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';
const assets={USDC:{token:USDC,aToken:'0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c',debt:'0x72e95b8931767c79ba4eee721354d6e99a61d004'},WETH:{token:WETH,aToken:'0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8',debt:'0xea51d7853eefb32b6ee06b1c12e6dcca88be0ffe'}};
function call(to:string,signature:string,arg?:string):ReadCall{return {to,data:'0x'+bytesToHex(keccak_256(new TextEncoder().encode(signature))).slice(0,8)+(arg?arg.slice(2).padStart(64,'0'):'')};}
/** Fixed destinations from Aave's address book. No provider-selected calls or URLs. */
export function readPlan(id:string):ReadPlan|undefined {
 const tokens:Record<string,string>={ERC20_TOKEN_METADATA:'0x514910771af9ca656af840dff83e8264ecf986ca',ERC20_USDC_DECIMALS:USDC,ERC20_WETH_DECIMALS:WETH,CHAINLINK_ETH_USD_FEED_DECIMALS:'0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419'};
 const token=tokens[id];if(token)return {calls:[call(token,'decimals()')],kind:'DECIMALS',contract:token};
 const match=/^AAVE_V3_(USDC|WETH)_(AVAILABLE_LIQUIDITY|RESERVE_UTILIZATION|TOTAL_VARIABLE_DEBT|LIQUIDATION_THRESHOLD|LOAN_TO_VALUE|SUPPLY_APY|VARIABLE_BORROW_APY)$/.exec(id==='ETHEREUM_LENDING_LIQUIDITY'?'AAVE_V3_USDC_AVAILABLE_LIQUIDITY':id);
 if(!match)return undefined;
 const asset=assets[match[1] as keyof typeof assets];
 const liquidity=call(asset.token,'balanceOf(address)',asset.aToken),debt=call(asset.debt,'totalSupply()');
 const kinds:Record<string,ReadPlan['kind']>={AVAILABLE_LIQUIDITY:'LIQUIDITY',RESERVE_UTILIZATION:'UTILIZATION',TOTAL_VARIABLE_DEBT:'DEBT',LIQUIDATION_THRESHOLD:'THRESHOLD',LOAN_TO_VALUE:'LTV',SUPPLY_APY:'SUPPLY_APY',VARIABLE_BORROW_APY:'BORROW_APY'};
 const kind=kinds[match[2]!]!;
 return {kind,contract:asset.token,calls:kind==='LIQUIDITY'?[liquidity]:kind==='DEBT'?[debt]:kind==='UTILIZATION'?[liquidity,debt]:kind==='LTV'||kind==='THRESHOLD'?[call(POOL,'getConfiguration(address)',asset.token)]:[call(DATA,'getReserveData(address)',asset.token)]};
}
function words(value:string):bigint[]{if(!/^0x(?:[a-f0-9]{64})+$/i.test(value)||value.length>4098)throw new Error('INVALID_ABI_RESPONSE');return value.slice(2).match(/.{64}/g)!.map(word=>BigInt('0x'+word));}
/** APY: floor(((1 + APR/31536000)^31536000 - 1) * 10000), using ray fixed-point arithmetic. */
function apy(rate:bigint):bigint{const ray=10n**27n;if(rate>10n*ray)throw new Error('RATE_OUT_OF_RANGE');let base=ray+rate/31536000n,power=31536000n,result=ray;while(power){if(power&1n)result=result*base/ray;base=base*base/ray;power>>=1n;}return (result-ray)*10000n/ray;}
export function decodeReadPlan(plan:ReadPlan,results:readonly string[]):string {
 if(results.length!==plan.calls.length)throw new Error('INCOMPLETE_SOURCE');
 const values=results.map(words),first=values[0]![0]!;
 switch(plan.kind){
  case 'DECIMALS':if(first>255n)throw new Error('INVALID_DECIMALS');return first.toString();
  case 'LIQUIDITY':case 'DEBT':return first.toString();
  case 'UTILIZATION':{const debt=values[1]![0]!,total=first+debt;return (total?debt*10000n/total:0n).toString();}
  case 'LTV':return (first&65535n).toString();
  case 'THRESHOLD':return ((first>>16n)&65535n).toString();
  case 'SUPPLY_APY':case 'BORROW_APY':if(values[0]!.length!==12)throw new Error('INVALID_RESERVE_ABI');return apy(values[0]![plan.kind==='SUPPLY_APY'?5:6]!).toString();
 }
}
export const REFERENCE_RPC_URL='https://eth.drpc.org';
