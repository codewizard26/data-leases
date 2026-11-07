import type {NextConfig} from 'next';
const gateway=(process.env.GATEWAY_URL??'http://127.0.0.1:3000').replace(/\/+$/,'');
const config:NextConfig={agentRules:false,compress:false,turbopack:{resolveAlias:Object.fromEntries(['analysis','research','bundle','buyer','lease-policy'].map(name=>['./'+name+'.js','../../packages/contracts/src/'+name+'.ts']))},async redirects(){return [{source:'/demo',destination:'/dashboard',permanent:false}];},async rewrites(){return [{source:'/',destination:gateway+'/about'},{source:'/about',destination:gateway+'/about'},{source:'/developer',destination:gateway+'/developer'},{source:'/api/:path*',destination:gateway+'/api/:path*'}];}};
export default config;
