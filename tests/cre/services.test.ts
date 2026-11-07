import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {VerificationRequestSchema} from '@data-leases/contracts';
import {SERVICE_POLICIES,readPlan,decodeReadPlan,evaluateServiceVerification} from '@data-leases/cre-adapter';
import {DEMO_SCENARIOS} from '../../packages/agents/src/scenarios.js';
const base=VerificationRequestSchema.parse(JSON.parse(readFileSync(new URL('./fixtures/request.json',import.meta.url),'utf8')));
const word=(value:bigint)=>value.toString(16).padStart(64,'0');
test('every active provider service has matching verification metadata and retired writes have none',()=>{
 expect(SERVICE_POLICIES.map(s=>s.questionTemplateId)).toEqual(DEMO_SCENARIOS.filter(s=>!s.retired).map(s=>s.questionTemplateId));
 for(const service of SERVICE_POLICIES){const task=DEMO_SCENARIOS.find(task=>task.questionTemplateId===service.questionTemplateId)!;expect(service).toMatchObject({metric:task.metric,unit:task.unit,methodologyVersion:task.methodologyVersion,evidencePolicyId:task.evidencePolicyId});}
});
for(const service of SERVICE_POLICIES){
 test(service.questionTemplateId+' uses only its own method and independent references',()=>{
  const request=VerificationRequestSchema.parse({...base,questionTemplateId:service.questionTemplateId,answer:{...base.answer,questionTemplateId:service.questionTemplateId,metric:service.metric,unit:service.unit,methodologyVersion:service.methodologyVersion,evidencePolicyId:service.evidencePolicyId,sourceContract:undefined},policy:{...base.policy,policyId:service.evidencePolicyId,allowedMetricIds:[service.metric]}});
  const plan=readPlan(service.questionTemplateId),observation={chainId:'eip155:1',contract:plan?.contract??'0x'+'00'.repeat(20),blockNumber:request.answer.sourceBlockNumber!,blockHash:request.answer.sourceBlockHash!,blockTimestamp:request.answer.deliveredAt,value:request.answer.value};
  const valid=evaluateServiceVerification(request,{evm:observation,http:observation},'MOCK',base.requestedAt);
  expect(valid.status).toBe(plan?'ACCEPTED':'INCONCLUSIVE');
  expect(evaluateServiceVerification(request,{},'MOCK',base.requestedAt).status).toBe('INCONCLUSIVE');
  if(plan){
   expect(evaluateServiceVerification({...request,answer:{...request.answer,value:'19'}},{evm:observation,http:observation},'MOCK',base.requestedAt).status).toBe('REJECTED');
   expect(evaluateServiceVerification(request,{evm:observation,http:{...observation,blockHash:'0x'+'00'.repeat(32)}},'MOCK',base.requestedAt).status).toBe('INCONCLUSIVE');
   expect(evaluateServiceVerification({...request,answer:{...request.answer,unit:'wrong-unit'}},{evm:observation,http:observation},'MOCK',base.requestedAt).status).toBe('REJECTED');
  }
 });
}
test('Aave calls decode exact liquidity, debt, utilization, config bits and compounded APY',()=>{
 expect(decodeReadPlan(readPlan('AAVE_V3_USDC_AVAILABLE_LIQUIDITY')!,['0x'+word(125000000n)])).toBe('125000000');
 expect(decodeReadPlan(readPlan('AAVE_V3_USDC_RESERVE_UTILIZATION')!,['0x'+word(25n),'0x'+word(75n)])).toBe('7500');
 const config=7500n+(7800n<<16n);
 expect(decodeReadPlan(readPlan('AAVE_V3_USDC_LOAN_TO_VALUE')!,['0x'+word(config)])).toBe('7500');
 expect(decodeReadPlan(readPlan('AAVE_V3_USDC_LIQUIDATION_THRESHOLD')!,['0x'+word(config)])).toBe('7800');
 const reserve=Array<bigint>(12).fill(0n);reserve[5]=5n*10n**25n;
 expect(decodeReadPlan(readPlan('AAVE_V3_USDC_SUPPLY_APY')!,['0x'+reserve.map(word).join('')])).toBe('512');
 expect(()=>decodeReadPlan(readPlan('ERC20_USDC_DECIMALS')!,['0x'+word(256n)])).toThrow('INVALID_DECIMALS');
 expect(()=>decodeReadPlan(readPlan('AAVE_V3_USDC_SUPPLY_APY')!,['0x'+word(0n)])).toThrow('INVALID_RESERVE_ABI');
 expect(readPlan('PRIVATE_TREASURY_USDC_BALANCE')).toBeUndefined();
});
