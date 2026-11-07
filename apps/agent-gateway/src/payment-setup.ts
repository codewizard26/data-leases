export function getPaymentSetup(environment:NodeJS.ProcessEnv=process.env){
 const account=(v:string|undefined)=>Boolean(v&&/^0\.0\.[1-9][0-9]*$/.test(v));
 const providers=[environment.HEDERA_PROVIDER_A_ACCOUNT_ID,environment.HEDERA_PROVIDER_B_ACCOUNT_ID];
 const max=environment.HEDERA_MAX_PAYMENT_TINYBARS;const capValid=Boolean(max&&/^[1-9][0-9]{0,18}$/.test(max)&&BigInt(max)<=9223372036854775807n);
 const missing:string[]=[];
 if(!account(environment.HEDERA_BUYER_ACCOUNT_ID))missing.push('HEDERA_BUYER_ACCOUNT_ID');
 if(!environment.HEDERA_BUYER_PRIVATE_KEY)missing.push('HEDERA_BUYER_PRIVATE_KEY');
 if(!['ECDSA','ED25519'].includes(environment.HEDERA_BUYER_KEY_TYPE??''))missing.push('HEDERA_BUYER_KEY_TYPE');
 providers.forEach((v,i)=>{if(!account(v))missing.push(i===0?'HEDERA_PROVIDER_A_ACCOUNT_ID':'HEDERA_PROVIDER_B_ACCOUNT_ID');});
 if(!capValid)missing.push('HEDERA_MAX_PAYMENT_TINYBARS');
 if(environment.PAYMENTS_ENABLED!=='true')missing.push('PAYMENTS_ENABLED=true');
 if(providers.some(p=>p&&p===environment.HEDERA_BUYER_ACCOUNT_ID))missing.push('SEPARATE_PROVIDER_RECIPIENT_REQUIRED');
 return {protocol:'x402 v2',scheme:'exact',network:'hedera:testnet',asset:'0.0.0',assetSymbol:'HBAR',decimals:8,facilitator:'https://x402.org/facilitator',buyerAccountId:account(environment.HEDERA_BUYER_ACCOUNT_ID)?environment.HEDERA_BUYER_ACCOUNT_ID:undefined,providerAccounts:providers.map(p=>account(p)?p:undefined),quotesAvailable:providers.every(account),ready:missing.length===0,missing,maxTinybars:capValid?max:undefined,portalUrl:'https://portal.hedera.com/'};
}
