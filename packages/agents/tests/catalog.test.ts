import {RESEARCH_TASKS} from '@data-leases/contracts';
import {expect,test} from 'vitest';
import {DEMO_SCENARIOS,publicTaskTemplate,scenarioForTemplate} from '../src/scenarios.js';

test('catalog adds twenty uniquely identified read tasks without replacing legacy tasks',()=>{
 expect(DEMO_SCENARIOS).toHaveLength(26+RESEARCH_TASKS.length);
 expect(new Set(DEMO_SCENARIOS.map(task=>task.id)).size).toBe(26+RESEARCH_TASKS.length);
 expect(new Set(DEMO_SCENARIOS.map(task=>task.questionTemplateId)).size).toBe(26+RESEARCH_TASKS.length);
 expect(DEMO_SCENARIOS.slice(6).filter(task=>task.operation==='READ')).toHaveLength(20);
 expect(DEMO_SCENARIOS.slice(6).filter(task=>task.operation==='READ').every(task=>task.operation==='READ')).toBe(true);
 expect(scenarioForTemplate('ETHEREUM_LENDING_LIQUIDITY')?.questionTemplateId).toBe('AAVE_V3_USDC_AVAILABLE_LIQUIDITY');
 expect(scenarioForTemplate('ERC20_TOKEN_METADATA')?.verificationSupport).toBe('LINK_CRE');
});

test('new tasks contain ten public and ten private synthetic measurements with honest verification limits',()=>{
 const added=DEMO_SCENARIOS.slice(6).filter(task=>task.operation==='READ');
 expect(added.filter(task=>task.dataAccess.classification==='PUBLIC')).toHaveLength(10);
 expect(added.filter(task=>task.dataAccess.classification==='PRIVATE')).toHaveLength(10);
 for(const task of added){
  expect(task).toMatchObject({synthetic:true,evidencePolicyId:task.dataAccess.classification==='PRIVATE'?'private-demo-policy-v1':'demo-policy-v1',verificationSupport:'UNSUPPORTED',demoTrustMode:'UNTRUSTED_MOCK'});
  expect(task.sourceContract).toBeUndefined();
  expect(task.value).toMatch(/^\d+$/);
  expect(task.description).toContain('Synthetic');
  expect(task.dataAccess.priceMultiplier).toBeGreaterThanOrEqual(1);
  expect(Number.isInteger(task.dataAccess.priceMultiplier)).toBe(true);
 }
});

test('public catalog projection strips values, computation prompts and private evidence',()=>{
 for(const task of DEMO_SCENARIOS.filter(task=>!task.retired)){
  const template=publicTaskTemplate(task);
  expect(template).not.toHaveProperty('value');
  expect(template).not.toHaveProperty('computationPrompt');
  expect(template).not.toHaveProperty('sourceContract');
  expect(template).not.toHaveProperty('evidenceRefs');
  expect(template.dataAccess).toMatchObject({visibility:'SINGLE_METRIC',license:'NO_REDISTRIBUTION'});
  expect(template.suggestedMaxAgeSeconds).toBeGreaterThan(0);
  if(task.dataAccess.classification==='PRIVATE'){
   expect(template.dataAccess.previewKind).toBe('METADATA_ONLY');
   expect(template.dataAccess.previewText).not.toContain(task.value);
   expect(template.description).not.toContain(task.value);
   expect(template.dataAccess.priceMultiplier).toBeGreaterThanOrEqual(4);
  }
 }
});

test('legacy provider rate multipliers remain unchanged',()=>{
 expect(DEMO_SCENARIOS.slice(0,6).map(task=>task.dataAccess.priceMultiplier)).toEqual([1,1,1,1,4,2]);
});


test('service catalog retires whole-write demo and bills only one metric or computation',()=>{
 expect(DEMO_SCENARIOS.filter(task=>!task.retired)).toHaveLength(25+RESEARCH_TASKS.length);
 const retired=DEMO_SCENARIOS.find(task=>task.operation==='WRITE')!;expect(retired.retired).toBe(true);
 expect(()=>publicTaskTemplate(retired)).toThrow('RETIRED_TASK');
 for(const task of DEMO_SCENARIOS.filter(task=>!task.retired)){
  expect(task.serviceUnit.includedMetrics).toBe(1);
  expect(task.serviceUnit.billingUnit).toBe(task.operation==='COMPUTE'?'PER_COMPUTATION':'PER_REQUEST');
  expect(task.dataAccess.retention).toBe(task.dataAccess.classification==='PRIVATE'?'BUYER_LOCAL_ONLY':'PUBLIC_HASH_RECEIPT');
 }
});

test('retired write service cannot be negotiated and is absent from agent cards',async()=>{
 const {startProvider,negotiate}=await import('../src/index.js');const provider=await startProvider({port:0,providerId:'catalog-provider',askMinor:'500',floorMinor:'300'});
 try{const card=await(await fetch(provider.baseUrl+'/.well-known/agent-card.json')).json();expect(card.skills.some((skill:{id:string})=>skill.id==='SIMULATED_LINK_REPORT_WRITE')).toBe(false);await expect(negotiate({baseUrl:provider.baseUrl,providerId:'catalog-provider',maxPriceMinor:'5000',questionTemplateId:'SIMULATED_LINK_REPORT_WRITE'})).rejects.toThrow('TASK_RETIRED');}finally{await provider.close();}
});
test('private service cannot release a value through the unpaid development currency',async()=>{
 const {startProvider,negotiate}=await import('../src/index.js');const provider=await startProvider({port:0,providerId:'private-provider',askMinor:'500',floorMinor:'300'});
 try{const result=await negotiate({baseUrl:provider.baseUrl,providerId:'private-provider',maxPriceMinor:'2000',questionTemplateId:'PRIVATE_AAVE_POSITION_HEALTH_FACTOR'});expect(result.status).toBe('REJECTED');expect(result.answer).toBeUndefined();}finally{await provider.close();}
});
