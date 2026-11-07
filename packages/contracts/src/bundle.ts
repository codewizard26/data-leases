/** Proposed additive bundle contract; requires both contributors' review before freezing. */
import {z} from 'zod';
const amount=z.string().regex(/^[1-9][0-9]{0,18}$/);
export const MeasurementIdsSchema=z.array(z.string().min(1).max(120)).min(1).max(13).refine(ids=>new Set(ids).size===ids.length,'DUPLICATE_MEASUREMENT');
export const FixedQuoteRequestSchema=z.object({runId:z.string().uuid(),measurementIds:MeasurementIdsSchema,maxAgeSeconds:z.number().int().min(1).max(86400)}).strict();
export const FixedBundleQuoteSchema=z.object({runId:z.string().uuid(),quoteId:z.string().uuid(),providerId:z.string().min(1).max(80),payTo:z.string().regex(/^0\.0\.[1-9][0-9]*$/),currency:z.literal('hedera:testnet/HBAR'),priceMinor:amount,expiresAt:z.string().datetime(),maxAgeSeconds:z.number().int().min(1).max(86400),items:z.array(z.object({questionTemplateId:z.string().min(1).max(120),priceMinor:amount}).strict()).min(1).max(13),termsHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().refine(q=>new Set(q.items.map(i=>i.questionTemplateId)).size===q.items.length&&q.items.reduce((sum,i)=>sum+BigInt(i.priceMinor),0n)===BigInt(q.priceMinor),'INVALID_BUNDLE_TOTAL');
export type FixedBundleQuote=z.infer<typeof FixedBundleQuoteSchema>;
