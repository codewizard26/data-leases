import type {NextConfig} from 'next';
// Gateway origin for the Node API (agents, SQLite, Parquet). Local dev defaults to loopback.
// On Vercel a loopback/private target is refused (DNS_HOSTNAME_RESOLVED_PRIVATE), so without
// GATEWAY_URL the hosted console serves the dashboard and a clear 503 for /api instead.
const configured=process.env.GATEWAY_URL?.trim().replace(/\/+$/,'');
const gateway=configured||(process.env.VERCEL?undefined:'http://127.0.0.1:3000');
const contracts=Object.fromEntries(['analysis','research','bundle','buyer','lease-policy'].map(name=>['./'+name+'.js','../../packages/contracts/src/'+name+'.ts']));
const config:NextConfig={
 agentRules:false,
 compress:false,
 turbopack:{resolveAlias:contracts},
 async redirects(){
  return [
   {source:'/demo',destination:'/dashboard',permanent:false},
   ...(gateway?[]:[{source:'/',destination:'/dashboard',permanent:false},{source:'/about',destination:'/dashboard',permanent:false},{source:'/developer',destination:'/dashboard',permanent:false}]),
  ];
 },
 async rewrites(){
  // beforeFiles: the gateway takes precedence over the app/api fallback route when configured.
  return {beforeFiles:gateway?[{source:'/',destination:gateway+'/about'},{source:'/about',destination:gateway+'/about'},{source:'/developer',destination:gateway+'/developer'},{source:'/api/:path*',destination:gateway+'/api/:path*'}]:[],afterFiles:[],fallback:[]};
 },
};
export default config;
