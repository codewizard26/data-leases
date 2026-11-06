import { expect, test } from 'vitest';
import { AnswerEnvelopeSchema } from '@data-leases/contracts';
import * as agents from '../src/index.js';
const templates = ['AAVE_V3_USDC_AVAILABLE_LIQUIDITY', 'AAVE_V3_USDC_RESERVE_UTILIZATION', 'DAO_TREASURY_RISK_SNAPSHOT'];
test('catalog marks every measurement synthetic and separates roadmap extension', () => {
 expect(agents.DEMO_SCENARIOS).toHaveLength(6);
 expect(agents.DEMO_SCENARIOS.every(scenario => scenario.demoTrustMode === 'UNTRUSTED_MOCK')).toBe(true);
 expect(agents.DEMO_SCENARIOS[2]?.description).toContain('Illustrative extension');
});
for (const questionTemplateId of templates) {
 test(`delivers ${questionTemplateId} as a structured answer over A2A HTTP`, async () => {
  const provider = await agents.startProvider({ port: 0, providerId: 'scenario-provider', askMinor: '500', floorMinor: '300' });
  try {
   const result = await agents.negotiate({ baseUrl: provider.baseUrl, providerId: 'scenario-provider', maxPriceMinor: '350', questionTemplateId });
   expect(result.status).toBe('AGREED');
   expect(result.deliveryStatus).toBe('DELIVERED_UNVERIFIED');
   const answer = AnswerEnvelopeSchema.parse(result.answer);
   expect(answer.questionTemplateId).toBe(questionTemplateId);
   expect(answer.runId).toBe(result.runId);
   expect(answer.providerId).toBe('scenario-provider');
   expect(answer.sessionId).toBe(result.transcript[0]?.sessionId);
   expect(answer.negotiationId).toBe(result.transcript[0]?.negotiationId);
   expect(answer.acceptedQuoteId).toBe(result.transcript.at(-1)?.quoteId);
   expect(answer.demoTrustMode).toBe('UNTRUSTED_MOCK');
   expect(answer.sourceContract).toBeUndefined();
   expect(answer.sourceBlockNumber).toBeUndefined();
   const scenario = agents.DEMO_SCENARIOS.find(item => item.questionTemplateId === questionTemplateId)!;
   expect(answer.value).toBe(scenario.value);
   expect(answer.unit).toBe(scenario.unit);
  } finally { await provider.close(); }
 });
}
test('below-floor negotiations deliver no answer', async () => {
 const provider = await agents.startProvider({ port: 0, providerId: 'expensive', askMinor: '500', floorMinor: '400' });
 try {
  const result = await agents.negotiate({ baseUrl: provider.baseUrl, providerId: 'expensive', maxPriceMinor: '350', questionTemplateId: templates[0] });
  expect(result.status).toBe('REJECTED');
  expect(result.answer).toBeUndefined();
 } finally { await provider.close(); }
});
test('unknown question templates fail before contacting an agent', async () => {
 await expect(agents.negotiate({ baseUrl: 'http://127.0.0.1:1', providerId: 'unreachable', maxPriceMinor: '1', questionTemplateId: 'UNRESTRICTED_PROMPT' })).rejects.toThrow('UNSUPPORTED_QUESTION_TEMPLATE');
});

test('LINK decimals negotiates policy-specific terms and remains an unverified mock answer', async () => {
 const provider = await agents.startProvider({ port: 0, providerId: 'link-provider', askMinor: '500', floorMinor: '300' });
 try {
  const result = await agents.negotiate({ baseUrl: provider.baseUrl, providerId: 'link-provider', maxPriceMinor: '350', questionTemplateId: 'ERC20_TOKEN_METADATA' });
  expect(result.status).toBe('AGREED');
  if (!('answer' in result)) throw new Error('Expected delivered answer');
  expect(result.answer).toMatchObject({ questionTemplateId: 'ERC20_TOKEN_METADATA', metric: 'ERC20_DECIMALS', unit: 'decimal-places', value: '18', evidencePolicyId: 'link-decimals-v1', methodologyVersion: 'link-decimals-v1', sourceContract: '0x514910771af9ca656af840dff83e8264ecf986ca', demoTrustMode: 'UNTRUSTED_MOCK' });
  expect(result.answer.sourceBlockNumber).toBeUndefined();
  expect(result.answer.sourceBlockHash).toBeUndefined();
  expect(result.deliveryStatus).toBe('DELIVERED_UNVERIFIED');
  expect(result.transcript.every(turn => turn.evidencePolicyId === 'link-decimals-v1')).toBe(true);
 } finally { await provider.close(); }
});

test('AI computation uses the existing A2A loop, a distinct rate, and executes only after acceptance',async()=>{
 let calls=0;
 const provider=await agents.startProvider({port:0,providerId:'compute-provider',askMinor:'500',floorMinor:'300',compute:{generate:async()=>{calls++;return {provider:'OPENROUTER',model:'test:injected',text:'Test-only model output; not a live inference.'};}}});
 try{const quote=await agents.negotiate({baseUrl:provider.baseUrl,providerId:'compute-provider',maxPriceMinor:'2000',questionTemplateId:'AI_LINK_EXPLANATION',quoteOnly:true});expect(quote.quote?.priceMinor).toBe('1000');expect(calls).toBe(0);const result=await agents.negotiate({baseUrl:provider.baseUrl,providerId:'compute-provider',maxPriceMinor:'2000',questionTemplateId:'AI_LINK_EXPLANATION',acceptQuote:quote.quote});expect(result.status).toBe('AGREED');expect(result.computation?.text).toContain('Test-only');expect(result.answer?.metric).toBe('demo.ai_report.generated_count');expect(calls).toBe(1);}finally{await provider.close();}
});
test('providers without a computation adapter do not advertise AI work',async()=>{const provider=await agents.startProvider({port:0,providerId:'read-only-provider',askMinor:'500',floorMinor:'300'});try{const card=await (await fetch(provider.baseUrl+'/.well-known/agent-card.json')).json();expect(card.skills.some((skill:{id:string})=>skill.id==='AI_LINK_EXPLANATION')).toBe(false);}finally{await provider.close();}});
