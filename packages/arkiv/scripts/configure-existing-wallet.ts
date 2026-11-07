import {readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {privateKeyToAccount} from 'viem/accounts';
import type {Hex} from 'viem';
const keyVariable=process.argv[2]??'ZERO_G_PRIVATE_KEY';if(!/^[A-Z][A-Z0-9_]*$/.test(keyVariable))throw new Error('INVALID_KEY_VARIABLE');const secret=process.env[keyVariable];if(!secret)throw new Error('EXISTING_TEST_WALLET_NOT_CONFIGURED');
const key=(secret.startsWith('0x')?secret:'0x'+secret) as Hex;const address=privateKeyToAccount(key).address;
const updates={ARKIV_PRIVATE_KEY_ENV:keyVariable,ARKIV_PUBLISHER_ADDRESS:address,ARKIV_TRUSTED_PUBLISHERS:address,ARKIV_PUBLISHING_ENABLED:'true',ARKIV_MAX_TRANSACTION_FEE_WEI:'100000000000000000',ARKIV_MAX_TOTAL_FEE_WEI:'500000000000000000'};
let source=readFileSync('.env','utf8');for(const [name,value] of Object.entries(updates)){const regex=new RegExp('^'+name+'=.*$','m');source=regex.test(source)?source.replace(regex,name+'='+value):source.trimEnd()+'\n'+name+'='+value+'\n';}writeFileSync('.env',source,{mode:0o600});chmodSync('.env',0o600);console.log(JSON.stringify({publisher:address,network:'Rabdi',privateKey:'Existing variable referenced; not copied',maximumPerTransactionTglm:'0.1',maximumTotalReservedFeesTglm:'0.5'}));
