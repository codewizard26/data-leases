import { startGateway } from './server.js';
const gateway = await startGateway({port:Number(process.env.WEB_PORT ?? '3000')});
console.log(`Data Leases local console: ${gateway.baseUrl}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {void gateway.close().then(() => process.exit(0));});
