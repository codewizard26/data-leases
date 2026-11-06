export interface TaskDataAccess {
  classification: 'PUBLIC' | 'PRIVATE';
  previewKind: 'SAMPLE' | 'METADATA_ONLY';
  previewText: string;
  visibility: 'SINGLE_METRIC';
  license: 'NO_REDISTRIBUTION';
  /** Integer multiplier of each provider's independently configured base rate. */
  priceMultiplier: number;
  retention: 'BUYER_LOCAL_ONLY' | 'PUBLIC_HASH_RECEIPT';
}
interface ScenarioFields {
  id: string;
  title: string;
  description: string;
  questionTemplateId: string;
  metric: string;
  unit: string;
  value: string;
  methodologyVersion: string;
  sourceContract: string | undefined;
  chainId: string;
  evidencePolicyId: string;
  demoTrustMode: 'UNTRUSTED_MOCK';
  synthetic: boolean;
}
type ScenarioDefinition = ScenarioFields & (
  | {operation: 'READ' | 'WRITE'}
  | {operation: 'COMPUTE'; computationPrompt: string}
);
export type DemoScenario = ScenarioDefinition & {
  category: string;
  dataAccess: TaskDataAccess;
  verificationSupport: 'LINK_CRE' | 'UNSUPPORTED';
  suggestedMaxAgeSeconds: number;
  retired: boolean;
  serviceUnit: {billingUnit: 'PER_REQUEST' | 'PER_COMPUTATION'; includedMetrics: 1; deliverable: string};
};

/** Synthetic examples based on the product roadmap, never observations of chain state. */
const LEGACY_SCENARIOS = [
  {
    operation: 'READ',
    id: 'aave-usdc-liquidity', title: 'Aave V3 · USDC available liquidity',
    description: 'Synthetic Ethereum lending reserve example from the product specification. No RPC or live Aave source is queried.',
    questionTemplateId: 'AAVE_V3_USDC_AVAILABLE_LIQUIDITY', metric: 'aave_v3.usdc.available_liquidity',
    unit: 'USDC_RAW_6_DECIMALS', value: '1250000000000',
    methodologyVersion: 'synthetic-demo-v1', sourceContract: undefined,
    chainId: 'eip155:1', evidencePolicyId: 'demo-policy-v1', demoTrustMode: 'UNTRUSTED_MOCK', synthetic: true,
  },
  {
    operation: 'READ',
    id: 'aave-usdc-utilization', title: 'Aave V3 · USDC reserve utilization',
    description: 'Synthetic reserve utilization example from the product specification. 6,750 basis points represents an illustrative 67.5 percent.',
    questionTemplateId: 'AAVE_V3_USDC_RESERVE_UTILIZATION', metric: 'aave_v3.usdc.reserve_utilization',
    unit: 'BASIS_POINTS', value: '6750',
    methodologyVersion: 'synthetic-demo-v1', sourceContract: undefined,
    chainId: 'eip155:1', evidencePolicyId: 'demo-policy-v1', demoTrustMode: 'UNTRUSTED_MOCK', synthetic: true,
  },
  {
    operation: 'READ',
    id: 'dao-treasury-risk', title: 'DAO treasury · illustrative risk snapshot',
    description: 'Illustrative extension of the roadmap treasury-monitoring persona. Synthetic score with no validated financial methodology; not investment advice or a verified risk metric.',
    questionTemplateId: 'DAO_TREASURY_RISK_SNAPSHOT', metric: 'demo.dao_treasury.risk_score',
    unit: 'SYNTHETIC_SCORE_0_TO_100', value: '32',
    methodologyVersion: 'synthetic-demo-v1', sourceContract: undefined,
    chainId: 'eip155:1', evidencePolicyId: 'demo-policy-v1', demoTrustMode: 'UNTRUSTED_MOCK', synthetic: true,
  },
  {
    operation: 'READ',
    id: 'link-token-decimals', title: 'LINK token · ERC-20 decimals',
    description: 'Synthetic LINK metadata answer for the CRE proof policy. No chain state or reference block is read by this provider; verification remains separate.',
    questionTemplateId: 'ERC20_TOKEN_METADATA', metric: 'ERC20_DECIMALS',
    unit: 'decimal-places', value: '18',
    methodologyVersion: 'link-decimals-v1', sourceContract: '0x514910771af9ca656af840dff83e8264ecf986ca',
    chainId: 'eip155:1', evidencePolicyId: 'link-decimals-v1', demoTrustMode: 'UNTRUSTED_MOCK', synthetic: true,
  },
  {
    operation:'WRITE',id:'write-link-report',title:'Write · LINK verification report',
    description:'Simulated report-writing utility. Higher posted rate than a read. No external API, onchain write, or durable report is created in this prototype.',
    questionTemplateId:'SIMULATED_LINK_REPORT_WRITE',metric:'demo.link_report.simulated_writes',unit:'SIMULATED_REPORTS',value:'1',
    chainId:'eip155:1',evidencePolicyId:'demo-policy-v1',demoTrustMode:'UNTRUSTED_MOCK',synthetic:true,methodologyVersion:'demo-report-write-v1',sourceContract:undefined,
  },
  {
    operation:'COMPUTE',id:'ai-link-explanation',title:'AI · explain LINK token decimals',
    description:'On-demand AI report from the selected provider’s configured model. Public fixed prompt; generated explanation is not independently verified financial data.',
    questionTemplateId:'AI_LINK_EXPLANATION',metric:'demo.ai_report.generated_count',unit:'GENERATED_REPORTS',value:'1',
    computationPrompt:'Explain what ERC-20 token decimals mean, using LINK with 18 decimal places as a clearly stated illustrative input. Give one exact raw-unit example and explain why decimals are not a token price. Limit the answer to 120 words. Do not claim to have queried a blockchain or verified live data.',
    chainId:'eip155:1',evidencePolicyId:'demo-policy-v1',demoTrustMode:'UNTRUSTED_MOCK',synthetic:true,methodologyVersion:'ai-explanation-v1',sourceContract:undefined,
  },
] as const;

function access(classification: TaskDataAccess['classification'], priceMultiplier: number): TaskDataAccess {
  return {
    classification,
    previewKind: classification === 'PRIVATE' ? 'METADATA_ONLY' : 'SAMPLE',
    previewText: classification === 'PRIVATE'
      ? 'Metadata only. One synthetic private metric is released to the local buyer after payment. No private values appear in this preview.'
      : 'Illustrative format only: one numeric metric with its unit. The preview is not the paid result or evidence of current chain state.',
    visibility: 'SINGLE_METRIC',
    license: 'NO_REDISTRIBUTION',
    priceMultiplier,
    retention: classification === 'PRIVATE' ? 'BUYER_LOCAL_ONLY' : 'PUBLIC_HASH_RECEIPT',
  };
}

/** Additional sandbox tasks use fabricated values only; none adds a live protocol adapter. */
function fixture(input: {
  id: string; title: string; questionTemplateId: string; metric: string; unit: string;
  value: string; category: string; classification: TaskDataAccess['classification'];
  priceMultiplier: number; suggestedMaxAgeSeconds?: number;
}): DemoScenario {
  return {
    operation: 'READ', id: input.id, title: input.title,
    description: input.classification === 'PRIVATE'
      ? 'Synthetic private fixture for the single-operator local sandbox. No real account, portfolio, company data or private API is queried. Payment does not establish production access authorization.'
      : 'Synthetic public-data fixture for testing discovery, pricing and delivery. No live protocol source is queried; this metric has no independent CRE verification adapter.',
    questionTemplateId: input.questionTemplateId, metric: input.metric, unit: input.unit, value: input.value,
    methodologyVersion: 'synthetic-demo-v1', sourceContract: undefined, chainId: 'eip155:1',
    evidencePolicyId: input.classification === 'PRIVATE' ? 'private-demo-policy-v1' : 'demo-policy-v1', demoTrustMode: 'UNTRUSTED_MOCK', synthetic: true,
    retired: false, serviceUnit: {billingUnit: 'PER_REQUEST', includedMetrics: 1, deliverable: 'One '+input.metric+' metric in '+input.unit+'.'},
    category: input.category, dataAccess: access(input.classification, input.priceMultiplier),
    verificationSupport: 'UNSUPPORTED', suggestedMaxAgeSeconds: input.suggestedMaxAgeSeconds ?? 300,
  };
}

const ADDITIONAL_SCENARIOS: readonly DemoScenario[] = [
  fixture({id:'aave-usdc-supply-apy',title:'Aave V3 · USDC supply APY',questionTemplateId:'AAVE_V3_USDC_SUPPLY_APY',metric:'demo.aave_v3.usdc.supply_apy',unit:'BASIS_POINTS',value:'420',category:'Aave reserves',classification:'PUBLIC',priceMultiplier:1}),
  fixture({id:'aave-usdc-borrow-apy',title:'Aave V3 · USDC variable borrow APY',questionTemplateId:'AAVE_V3_USDC_VARIABLE_BORROW_APY',metric:'demo.aave_v3.usdc.variable_borrow_apy',unit:'BASIS_POINTS',value:'610',category:'Aave reserves',classification:'PUBLIC',priceMultiplier:1}),
  fixture({id:'aave-usdc-variable-debt',title:'Aave V3 · USDC total variable debt',questionTemplateId:'AAVE_V3_USDC_TOTAL_VARIABLE_DEBT',metric:'demo.aave_v3.usdc.total_variable_debt',unit:'USDC_RAW_6_DECIMALS',value:'875000000000',category:'Aave reserves',classification:'PUBLIC',priceMultiplier:2}),
  fixture({id:'aave-usdc-liquidation-threshold',title:'Aave V3 · USDC liquidation threshold',questionTemplateId:'AAVE_V3_USDC_LIQUIDATION_THRESHOLD',metric:'demo.aave_v3.usdc.liquidation_threshold',unit:'BASIS_POINTS',value:'7800',category:'Aave reserves',classification:'PUBLIC',priceMultiplier:1}),
  fixture({id:'aave-usdc-loan-to-value',title:'Aave V3 · USDC loan-to-value limit',questionTemplateId:'AAVE_V3_USDC_LOAN_TO_VALUE',metric:'demo.aave_v3.usdc.loan_to_value',unit:'BASIS_POINTS',value:'7500',category:'Aave reserves',classification:'PUBLIC',priceMultiplier:1}),
  fixture({id:'aave-weth-liquidity',title:'Aave V3 · WETH available liquidity',questionTemplateId:'AAVE_V3_WETH_AVAILABLE_LIQUIDITY',metric:'demo.aave_v3.weth.available_liquidity',unit:'WETH_RAW_18_DECIMALS',value:'42000000000000000000000',category:'Aave reserves',classification:'PUBLIC',priceMultiplier:2}),
  fixture({id:'aave-weth-utilization',title:'Aave V3 · WETH reserve utilization',questionTemplateId:'AAVE_V3_WETH_RESERVE_UTILIZATION',metric:'demo.aave_v3.weth.reserve_utilization',unit:'BASIS_POINTS',value:'5900',category:'Aave reserves',classification:'PUBLIC',priceMultiplier:2}),
  fixture({id:'usdc-token-decimals',title:'USDC token · ERC-20 decimals',questionTemplateId:'ERC20_USDC_DECIMALS',metric:'demo.erc20.usdc.decimals',unit:'decimal-places',value:'6',category:'Token metadata',classification:'PUBLIC',priceMultiplier:1,suggestedMaxAgeSeconds:3600}),
  fixture({id:'weth-token-decimals',title:'WETH token · ERC-20 decimals',questionTemplateId:'ERC20_WETH_DECIMALS',metric:'demo.erc20.weth.decimals',unit:'decimal-places',value:'18',category:'Token metadata',classification:'PUBLIC',priceMultiplier:1,suggestedMaxAgeSeconds:3600}),
  fixture({id:'chainlink-eth-usd-decimals',title:'Chainlink · ETH/USD feed decimals',questionTemplateId:'CHAINLINK_ETH_USD_FEED_DECIMALS',metric:'demo.chainlink.eth_usd.feed_decimals',unit:'decimal-places',value:'8',category:'Oracle metadata',classification:'PUBLIC',priceMultiplier:3,suggestedMaxAgeSeconds:3600}),
  fixture({id:'private-aave-health-factor',title:'Private Aave position · health factor',questionTemplateId:'PRIVATE_AAVE_POSITION_HEALTH_FACTOR',metric:'demo.private.aave.health_factor',unit:'RATIO_RAW_18_DECIMALS',value:'1840000000000000000',category:'Private positions',classification:'PRIVATE',priceMultiplier:4}),
  fixture({id:'private-aave-collateral',title:'Private Aave position · collateral value',questionTemplateId:'PRIVATE_AAVE_COLLATERAL_VALUE',metric:'demo.private.aave.collateral_value',unit:'USD_RAW_6_DECIMALS',value:'240000000000',category:'Private positions',classification:'PRIVATE',priceMultiplier:4}),
  fixture({id:'private-aave-debt',title:'Private Aave position · debt value',questionTemplateId:'PRIVATE_AAVE_DEBT_VALUE',metric:'demo.private.aave.debt_value',unit:'USD_RAW_6_DECIMALS',value:'97500000000',category:'Private positions',classification:'PRIVATE',priceMultiplier:4}),
  fixture({id:'private-aave-liquidation-buffer',title:'Private Aave position · liquidation buffer',questionTemplateId:'PRIVATE_AAVE_LIQUIDATION_BUFFER',metric:'demo.private.aave.liquidation_buffer',unit:'BASIS_POINTS',value:'2280',category:'Private positions',classification:'PRIVATE',priceMultiplier:5}),
  fixture({id:'private-treasury-usdc',title:'Private treasury · USDC balance',questionTemplateId:'PRIVATE_TREASURY_USDC_BALANCE',metric:'demo.private.treasury.usdc_balance',unit:'USDC_RAW_6_DECIMALS',value:'375000000000',category:'Private treasury',classification:'PRIVATE',priceMultiplier:4}),
  fixture({id:'private-treasury-runway',title:'Private treasury · cash runway',questionTemplateId:'PRIVATE_TREASURY_CASH_RUNWAY',metric:'demo.private.treasury.cash_runway',unit:'DAYS',value:'218',category:'Private treasury',classification:'PRIVATE',priceMultiplier:6,suggestedMaxAgeSeconds:3600}),
  fixture({id:'private-treasury-outflows',title:'Private treasury · 30-day outflows',questionTemplateId:'PRIVATE_TREASURY_30D_OUTFLOWS',metric:'demo.private.treasury.outflows_30d',unit:'USD_RAW_6_DECIMALS',value:'47000000000',category:'Private treasury',classification:'PRIVATE',priceMultiplier:6,suggestedMaxAgeSeconds:3600}),
  fixture({id:'private-portfolio-concentration',title:'Private portfolio · largest asset weight',questionTemplateId:'PRIVATE_PORTFOLIO_LARGEST_ASSET_WEIGHT',metric:'demo.private.portfolio.largest_asset_weight',unit:'BASIS_POINTS',value:'3850',category:'Private portfolio',classification:'PRIVATE',priceMultiplier:5}),
  fixture({id:'private-portfolio-stress-loss',title:'Private portfolio · stress-loss estimate',questionTemplateId:'PRIVATE_PORTFOLIO_STRESS_LOSS',metric:'demo.private.portfolio.stress_loss',unit:'USD_RAW_6_DECIMALS',value:'61800000000',category:'Private portfolio',classification:'PRIVATE',priceMultiplier:8}),
  fixture({id:'private-portfolio-counterparty',title:'Private portfolio · counterparty exposure',questionTemplateId:'PRIVATE_PORTFOLIO_COUNTERPARTY_EXPOSURE',metric:'demo.private.portfolio.counterparty_exposure',unit:'USD_RAW_6_DECIMALS',value:'82000000000',category:'Private portfolio',classification:'PRIVATE',priceMultiplier:7}),
];

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  ...LEGACY_SCENARIOS.map((scenario): DemoScenario => ({
    ...scenario,
    category: scenario.operation === 'WRITE' ? 'Reports' : scenario.operation === 'COMPUTE' ? 'AI computation' : scenario.id.startsWith('aave-') ? 'Aave reserves' : scenario.questionTemplateId === 'ERC20_TOKEN_METADATA' ? 'Token metadata' : 'Treasury demo',
    dataAccess: access('PUBLIC', scenario.operation === 'WRITE' ? 4 : scenario.operation === 'COMPUTE' ? 2 : 1),
    verificationSupport: scenario.questionTemplateId === 'ERC20_TOKEN_METADATA' ? 'LINK_CRE' : 'UNSUPPORTED',
    suggestedMaxAgeSeconds: scenario.questionTemplateId === 'ERC20_TOKEN_METADATA' ? 60 : 300,
    retired: scenario.operation === 'WRITE',
    serviceUnit: {billingUnit: scenario.operation === 'COMPUTE' ? 'PER_COMPUTATION' : 'PER_REQUEST', includedMetrics: 1, deliverable: scenario.operation === 'COMPUTE' ? 'One generated LINK explanation, at most 120 words.' : 'One '+scenario.metric+' metric in '+scenario.unit+'.'},
  })),
  ...ADDITIONAL_SCENARIOS,
];

/** Public catalog projection: never serialize answer values, prompts or source evidence. */
export function publicTaskTemplate(scenario: DemoScenario) {
  if (scenario.retired) throw new Error('RETIRED_TASK');
  return {
    id: scenario.id, operation: scenario.operation, title: scenario.title, description: scenario.description,
    questionTemplateId: scenario.questionTemplateId, metric: scenario.metric, unit: scenario.unit,
    methodologyVersion: scenario.methodologyVersion, chainId: scenario.chainId,
    evidencePolicyId: scenario.evidencePolicyId, demoTrustMode: scenario.demoTrustMode,
    synthetic: scenario.synthetic, category: scenario.category,
    dataAccess: {...scenario.dataAccess}, verificationSupport: scenario.verificationSupport,
    suggestedMaxAgeSeconds: scenario.suggestedMaxAgeSeconds,
    retired: scenario.retired, serviceUnit: {...scenario.serviceUnit},
  };
}

/** Preserve the original negotiation template as an alias of the first scenario. */
export function scenarioForTemplate(questionTemplateId: string): DemoScenario | undefined {
  return questionTemplateId === 'ETHEREUM_LENDING_LIQUIDITY' ? DEMO_SCENARIOS[0] : DEMO_SCENARIOS.find(scenario => scenario.questionTemplateId === questionTemplateId);
}
