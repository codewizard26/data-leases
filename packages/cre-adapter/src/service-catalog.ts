/** Verification metadata only. Catalog parity is checked against provider services in tests. */
export const SERVICE_POLICIES = [
  {
    "questionTemplateId": "AAVE_V3_USDC_AVAILABLE_LIQUIDITY",
    "metric": "aave_v3.usdc.available_liquidity",
    "unit": "USDC_RAW_6_DECIMALS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": false
  },
  {
    "questionTemplateId": "AAVE_V3_USDC_RESERVE_UTILIZATION",
    "metric": "aave_v3.usdc.reserve_utilization",
    "unit": "BASIS_POINTS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": false
  },
  {
    "questionTemplateId": "DAO_TREASURY_RISK_SNAPSHOT",
    "metric": "demo.dao_treasury.risk_score",
    "unit": "SYNTHETIC_SCORE_0_TO_100",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": false
  },
  {
    "questionTemplateId": "ERC20_TOKEN_METADATA",
    "metric": "ERC20_DECIMALS",
    "unit": "decimal-places",
    "methodologyVersion": "link-decimals-v1",
    "evidencePolicyId": "link-decimals-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": false
  },
  {
    "questionTemplateId": "AI_LINK_EXPLANATION",
    "metric": "demo.ai_report.generated_count",
    "unit": "GENERATED_REPORTS",
    "methodologyVersion": "ai-explanation-v1",
    "evidencePolicyId": "demo-policy-v1",
    "operation": "COMPUTE",
    "chainId": "eip155:1",
    "private": false
  },
  {
    "questionTemplateId": "AAVE_V3_USDC_SUPPLY_APY",
    "metric": "demo.aave_v3.usdc.supply_apy",
    "unit": "BASIS_POINTS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": false
  },
  {
    "questionTemplateId": "AAVE_V3_USDC_VARIABLE_BORROW_APY",
    "metric": "demo.aave_v3.usdc.variable_borrow_apy",
    "unit": "BASIS_POINTS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": false
  },
  {
    "questionTemplateId": "AAVE_V3_USDC_TOTAL_VARIABLE_DEBT",
    "metric": "demo.aave_v3.usdc.total_variable_debt",
    "unit": "USDC_RAW_6_DECIMALS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": false
  },
  {
    "questionTemplateId": "AAVE_V3_USDC_LIQUIDATION_THRESHOLD",
    "metric": "demo.aave_v3.usdc.liquidation_threshold",
    "unit": "BASIS_POINTS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": false
  },
  {
    "questionTemplateId": "AAVE_V3_USDC_LOAN_TO_VALUE",
    "metric": "demo.aave_v3.usdc.loan_to_value",
    "unit": "BASIS_POINTS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": false
  },
  {
    "questionTemplateId": "AAVE_V3_WETH_AVAILABLE_LIQUIDITY",
    "metric": "demo.aave_v3.weth.available_liquidity",
    "unit": "WETH_RAW_18_DECIMALS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": false
  },
  {
    "questionTemplateId": "AAVE_V3_WETH_RESERVE_UTILIZATION",
    "metric": "demo.aave_v3.weth.reserve_utilization",
    "unit": "BASIS_POINTS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": false
  },
  {
    "questionTemplateId": "ERC20_USDC_DECIMALS",
    "metric": "demo.erc20.usdc.decimals",
    "unit": "decimal-places",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": false
  },
  {
    "questionTemplateId": "ERC20_WETH_DECIMALS",
    "metric": "demo.erc20.weth.decimals",
    "unit": "decimal-places",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": false
  },
  {
    "questionTemplateId": "CHAINLINK_ETH_USD_FEED_DECIMALS",
    "metric": "demo.chainlink.eth_usd.feed_decimals",
    "unit": "decimal-places",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": false
  },
  {
    "questionTemplateId": "PRIVATE_AAVE_POSITION_HEALTH_FACTOR",
    "metric": "demo.private.aave.health_factor",
    "unit": "RATIO_RAW_18_DECIMALS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "private-demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": true
  },
  {
    "questionTemplateId": "PRIVATE_AAVE_COLLATERAL_VALUE",
    "metric": "demo.private.aave.collateral_value",
    "unit": "USD_RAW_6_DECIMALS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "private-demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": true
  },
  {
    "questionTemplateId": "PRIVATE_AAVE_DEBT_VALUE",
    "metric": "demo.private.aave.debt_value",
    "unit": "USD_RAW_6_DECIMALS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "private-demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": true
  },
  {
    "questionTemplateId": "PRIVATE_AAVE_LIQUIDATION_BUFFER",
    "metric": "demo.private.aave.liquidation_buffer",
    "unit": "BASIS_POINTS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "private-demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": true
  },
  {
    "questionTemplateId": "PRIVATE_TREASURY_USDC_BALANCE",
    "metric": "demo.private.treasury.usdc_balance",
    "unit": "USDC_RAW_6_DECIMALS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "private-demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": true
  },
  {
    "questionTemplateId": "PRIVATE_TREASURY_CASH_RUNWAY",
    "metric": "demo.private.treasury.cash_runway",
    "unit": "DAYS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "private-demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": true
  },
  {
    "questionTemplateId": "PRIVATE_TREASURY_30D_OUTFLOWS",
    "metric": "demo.private.treasury.outflows_30d",
    "unit": "USD_RAW_6_DECIMALS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "private-demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": true
  },
  {
    "questionTemplateId": "PRIVATE_PORTFOLIO_LARGEST_ASSET_WEIGHT",
    "metric": "demo.private.portfolio.largest_asset_weight",
    "unit": "BASIS_POINTS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "private-demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": true
  },
  {
    "questionTemplateId": "PRIVATE_PORTFOLIO_STRESS_LOSS",
    "metric": "demo.private.portfolio.stress_loss",
    "unit": "USD_RAW_6_DECIMALS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "private-demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": true
  },
  {
    "questionTemplateId": "PRIVATE_PORTFOLIO_COUNTERPARTY_EXPOSURE",
    "metric": "demo.private.portfolio.counterparty_exposure",
    "unit": "USD_RAW_6_DECIMALS",
    "methodologyVersion": "synthetic-demo-v1",
    "evidencePolicyId": "private-demo-policy-v1",
    "operation": "READ",
    "chainId": "eip155:1",
    "private": true
  }
] as const;
