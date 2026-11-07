import {z} from 'zod';

const id=z.string().min(1).max(256);
const amount=z.string().regex(/^[1-9][0-9]{0,18}$/);
const schedule=z.object({intervalSeconds:z.number().int().min(60).max(604800),mode:z.enum(['DIRECT_URL','LOCAL_REGISTRY','ARKIV','HYBRID']),directCardUrl:z.string().url().optional()}).strict().refine(value=>value.mode!=='DIRECT_URL'||Boolean(value.directCardUrl),{message:'DIRECT_URL requires a card URL'});
export const LeasePolicySchema=z.object({leaseId:z.string().uuid(),questionTemplateId:id,currency:z.literal('hedera:testnet/HBAR'),providerIds:z.array(id).min(1).max(20),perRequestTinybars:amount,totalTinybars:amount,expiresAt:z.string().datetime(),maxAgeSeconds:z.number().int().min(1).max(86400),maxRounds:z.number().int().min(2).max(3),paymentsAuthorized:z.boolean().default(true),maxRuns:z.number().int().min(1).max(1000).optional(),schedule:schedule.optional()}).strict();
export type LeasePolicy=z.infer<typeof LeasePolicySchema>;
