import type {NextConfig} from 'next';
const config:NextConfig={agentRules:false,compress:false,async rewrites(){return [{source:'/api/:path*',destination:'http://127.0.0.1:3000/api/:path*'}];}};
export default config;
