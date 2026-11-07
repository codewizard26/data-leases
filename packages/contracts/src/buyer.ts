import {z} from 'zod';

/** Proposed World-backed buyer contracts; contributor review is required before freezing. */
const id=z.string().min(1).max(256);
const amount=z.string().regex(/^[1-9][0-9]{0,18}$/);
const schedule=z.object({intervalSeconds:z.number().int().min(60).max(604800),mode:z.enum(['DIRECT_URL','LOCAL_REGISTRY','ARKIV','HYBRID']),directCardUrl:z.string().url().optional()}).strict().refine(value=>value.mode!=='DIRECT_URL'||Boolean(value.directCardUrl),{message:'DIRECT_URL requires a card URL'});
export const BuyerLeasePolicySchema=z.object({leaseId:z.string().uuid(),questionTemplateId:id,currency:z.literal('hedera:testnet/HBAR'),providerIds:z.array(id).min(1).max(20),perRequestTinybars:amount,totalTinybars:amount,expiresAt:z.string().datetime(),maxAgeSeconds:z.number().int().min(1).max(86400),maxRounds:z.number().int().min(2).max(3),paymentsAuthorized:z.boolean().default(true),maxRuns:z.number().int().min(1).max(1000).optional(),schedule:schedule.optional()}).strict();
export type BuyerLeasePolicy=z.infer<typeof BuyerLeasePolicySchema>;
export const BuyerApprovalPurposeSchema=z.enum(['ACTIVATE_LEASE','INCREASE_AUTHORITY']);
export const BuyerApprovalSchema=z.object({approvalId:z.string().uuid(),buyerId:id,leaseId:z.string().uuid(),baseRevision:z.number().int().nonnegative(),policyHash:z.string().regex(/^[a-f0-9]{64}$/),purpose:BuyerApprovalPurposeSchema,nonce:id,expiresAt:z.string().datetime(),status:z.enum(['PENDING','APPROVED','DENIED','EXPIRED']),proposedPolicy:BuyerLeasePolicySchema}).strict();
export type BuyerApproval=z.infer<typeof BuyerApprovalSchema>;
export const BuyerSessionSchema=z.object({buyerId:id,expiresAt:z.string().datetime(),csrfToken:id}).strict();
export type BuyerSession=z.infer<typeof BuyerSessionSchema>;
/** Internal server adapter output. Never parse this object from a browser request. */
export interface BuyerActionBinding {buyerId:string;nonce:string;purpose:z.infer<typeof BuyerApprovalPurposeSchema>;policyHash:string}
