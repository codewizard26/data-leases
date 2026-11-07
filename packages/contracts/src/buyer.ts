import {z} from 'zod';
import {LeasePolicySchema} from './lease-policy.js';
export {LeasePolicySchema as BuyerLeasePolicySchema} from './lease-policy.js';
export type {LeasePolicy as BuyerLeasePolicy} from './lease-policy.js';
const id=z.string().min(1).max(256);
export const BuyerApprovalPurposeSchema=z.enum(['ACTIVATE_LEASE','INCREASE_AUTHORITY']);
export const BuyerApprovalSchema=z.object({approvalId:z.string().uuid(),buyerId:id,leaseId:z.string().uuid(),baseRevision:z.number().int().nonnegative(),policyHash:z.string().regex(/^[a-f0-9]{64}$/),purpose:BuyerApprovalPurposeSchema,nonce:id,expiresAt:z.string().datetime(),status:z.enum(['PENDING','APPROVED','DENIED','EXPIRED']),proposedPolicy:LeasePolicySchema}).strict();
export type BuyerApproval=z.infer<typeof BuyerApprovalSchema>;
export const BuyerSessionSchema=z.object({buyerId:id,expiresAt:z.string().datetime(),csrfToken:id}).strict();
export type BuyerSession=z.infer<typeof BuyerSessionSchema>;
/** Internal server adapter output. Never parse this object from a browser request. */
export interface BuyerActionBinding {buyerId:string;nonce:string;purpose:z.infer<typeof BuyerApprovalPurposeSchema>;policyHash:string}
