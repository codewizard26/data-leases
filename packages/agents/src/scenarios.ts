/** Synthetic examples based on the product roadmap, never observations of chain state. */
export const DEMO_SCENARIOS = [
  {
    id: 'aave-usdc-liquidity', title: 'Aave V3 · USDC available liquidity',
    description: 'Synthetic Ethereum lending reserve example from the product specification. No RPC or live Aave source is queried.',
    questionTemplateId: 'AAVE_V3_USDC_AVAILABLE_LIQUIDITY', metric: 'aave_v3.usdc.available_liquidity',
    unit: 'USDC_RAW_6_DECIMALS', value: '1250000000000',
    methodologyVersion: 'synthetic-demo-v1', sourceContract: undefined,
    chainId: 'eip155:1', evidencePolicyId: 'demo-policy-v1', demoTrustMode: 'UNTRUSTED_MOCK', synthetic: true,
  },
  {
    id: 'aave-usdc-utilization', title: 'Aave V3 · USDC reserve utilization',
    description: 'Synthetic reserve utilization example from the product specification. 6,750 basis points represents an illustrative 67.5 percent.',
    questionTemplateId: 'AAVE_V3_USDC_RESERVE_UTILIZATION', metric: 'aave_v3.usdc.reserve_utilization',
    unit: 'BASIS_POINTS', value: '6750',
    methodologyVersion: 'synthetic-demo-v1', sourceContract: undefined,
    chainId: 'eip155:1', evidencePolicyId: 'demo-policy-v1', demoTrustMode: 'UNTRUSTED_MOCK', synthetic: true,
  },
  {
    id: 'dao-treasury-risk', title: 'DAO treasury · illustrative risk snapshot',
    description: 'Illustrative extension of the roadmap treasury-monitoring persona. Synthetic score with no validated financial methodology; not investment advice or a verified risk metric.',
    questionTemplateId: 'DAO_TREASURY_RISK_SNAPSHOT', metric: 'demo.dao_treasury.risk_score',
    unit: 'SYNTHETIC_SCORE_0_TO_100', value: '32',
    methodologyVersion: 'synthetic-demo-v1', sourceContract: undefined,
    chainId: 'eip155:1', evidencePolicyId: 'demo-policy-v1', demoTrustMode: 'UNTRUSTED_MOCK', synthetic: true,
  },
  {
    id: 'link-token-decimals', title: 'LINK token · ERC-20 decimals',
    description: 'Synthetic LINK metadata answer for the CRE proof policy. No chain state or reference block is read by this provider; verification remains separate.',
    questionTemplateId: 'ERC20_TOKEN_METADATA', metric: 'ERC20_DECIMALS',
    unit: 'decimal-places', value: '18',
    methodologyVersion: 'link-decimals-v1', sourceContract: '0x514910771af9ca656af840dff83e8264ecf986ca',
    chainId: 'eip155:1', evidencePolicyId: 'link-decimals-v1', demoTrustMode: 'UNTRUSTED_MOCK', synthetic: true,
  },
] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];
/** Preserve the original negotiation template as an alias of the first scenario. */
export function scenarioForTemplate(questionTemplateId: string): DemoScenario | undefined {
  return questionTemplateId === 'ETHEREUM_LENDING_LIQUIDITY' ? DEMO_SCENARIOS[0] : DEMO_SCENARIOS.find(scenario => scenario.questionTemplateId === questionTemplateId);
}
