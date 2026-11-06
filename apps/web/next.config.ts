import type {NextConfig} from 'next';
const config:NextConfig={agentRules:false,compress:false,async rewrites(){return [{source:'/about',destination:'http://127.0.0.1:3000/about'},{source:'/developer',destination:'http://127.0.0.1:3000/developer'},{source:'/api/:path*',destination:'http://127.0.0.1:3000/api/:path*'}];}};
export default config;
