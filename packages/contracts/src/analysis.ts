/** Proposed additive paid-analysis boundary; contributor review required before freezing. */
import {z} from 'zod';
import {ResearchEvidenceSchema} from './research.js';
export const AnalysisPersonaSchema=z.enum(['TRADER','MARKET_MAKER','LIQUIDITY_PROVIDER']);
export type AnalysisPersona=z.infer<typeof AnalysisPersonaSchema>;
export const ANALYSIS_REQUIREMENTS:Record<AnalysisPersona,readonly string[]>={
 TRADER:['AAVE_V3_USDC_AVAILABLE_LIQUIDITY','AAVE_V3_USDC_RESERVE_UTILIZATION','AAVE_V3_USDC_VARIABLE_BORROW_APY'],
 MARKET_MAKER:['AAVE_V3_USDC_AVAILABLE_LIQUIDITY','AAVE_V3_USDC_RESERVE_UTILIZATION','AAVE_V3_USDC_VARIABLE_BORROW_APY','AAVE_V3_USDC_SUPPLY_APY'],
 LIQUIDITY_PROVIDER:['AAVE_V3_USDC_AVAILABLE_LIQUIDITY','AAVE_V3_USDC_RESERVE_UTILIZATION','AAVE_V3_USDC_SUPPLY_APY'],
};
export const AnalysisFeeSchema=z.object({persona:AnalysisPersonaSchema,priceMinor:z.string().regex(/^[1-9][0-9]{0,18}$/)}).strict();
const prose=z.string().min(1).max(800).refine(text=>!/[0-9]/.test(text),'Numeric claims belong in exact source facts, not model prose');
const finding=z.object({text:prose,evidenceIds:z.array(z.string().max(120)).min(1).max(7)}).strict();
export const AnalysisNarrativeSchema=z.object({headline:prose,summary:prose,findings:z.array(finding).min(2).max(5),watchpoints:z.array(finding).min(1).max(4),nextChecks:z.array(prose).min(1).max(4)}).strict();
export const PaidAnalysisBriefSchema=z.object({research:ResearchEvidenceSchema.optional(),runId:z.string().uuid(),persona:AnalysisPersonaSchema,provider:z.enum(['CLAUDE','OPENROUTER','0G']),model:z.string().min(1).max(256),generatedAt:z.string().datetime(),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/),narrative:AnalysisNarrativeSchema,limitations:z.array(z.string().min(1).max(500)).min(1).max(10),derived:z.array(z.object({label:z.string().max(100),value:z.string().max(100),unit:z.string().max(50),evidenceIds:z.array(z.string().max(120)).min(1).max(4)}).strict()).max(5),status:z.literal('AI_INTERPRETATION_NOT_INDEPENDENTLY_VERIFIED')}).strict();
export type PaidAnalysisBrief=z.infer<typeof PaidAnalysisBriefSchema>;
