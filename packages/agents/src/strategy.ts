import type { ComputeAdapter, ComputeOutput } from './compute.js';
import type {SellerStyle} from './provider-profiles.js';

export interface BuyerStrategyInput { quoteMinor: string; capMinor: string; round: number }
export interface SellerStrategyInput { kind: 'initial' | 'counter'; askMinor: string; floorMinor: string; incomingPriceMinor?: string; round: number }
export interface StrategyMetadata { reason: string; provider: Exclude<ComputeOutput['provider'], 'MOCK'>; model: string }
export type BuyerDecision = StrategyMetadata & { action: 'ACCEPT' | 'COUNTER' | 'REJECT'; priceMinor?: string };
export type SellerDecision = StrategyMetadata & { action: 'PROPOSE' | 'REJECT'; priceMinor?: string };
export interface NegotiationStrategy {
  buyer(input: BuyerStrategyInput): Promise<BuyerDecision>;
  seller(input: SellerStrategyInput): Promise<SellerDecision>;
}
function invalid(): never { throw new Error('AI_INVALID_DECISION'); }
function amount(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 78 || !/^(0|[1-9][0-9]*)$/.test(value)) invalid();
  return BigInt(value);
}
function validateRound(round: number): void {
  if (!Number.isInteger(round) || round < 1 || round > 3) invalid();
}
interface ParsedDecision extends StrategyMetadata { action: string; priceMinor?: string }
/** Model chooses a proposal; this layer enforces the economic boundaries independently. */
export class AiNegotiationStrategy implements NegotiationStrategy {
  constructor(private readonly adapter: ComputeAdapter,private readonly sellerStyle:SellerStyle='BALANCED') {}
  private async decide(role: 'BUYER' | 'SELLER', terms: BuyerStrategyInput | SellerStrategyInput): Promise<ParsedDecision> {
    const instruction = role === 'BUYER'
      ? 'Your objective is to minimize the agreed price within your cap. allowedActions: ["ACCEPT","COUNTER","REJECT"]. Choose ACCEPT only at the exact quoteMinor and only if <= capMinor. Otherwise choose COUNTER at a nonnegative integer priceMinor <= capMinor and strictly less than quoteMinor, or REJECT.'
      : 'Your objective is to maximize your agreed price within the floor and asking ceiling. allowedActions: ["PROPOSE","REJECT"]. Permitted output actions are ONLY PROPOSE or REJECT, never ACCEPT or COUNTER. Choose PROPOSE at a nonnegative integer priceMinor >= floorMinor and <= askMinor, or REJECT. If you accept the incoming offer, output PROPOSE at that exact incomingPriceMinor, provided it meets your bounds. Consider the incoming offer when present.';
    const style=role==='SELLER'?({FLEXIBLE:'Prefer an acceptable counteroffer over losing the sale.',BALANCED:'Balance margin with reaching agreement.',FIRM:'Prefer preserving your asking margin; you may decline low counteroffers.'}[this.sellerStyle]):'';
    const output = await this.adapter.generate({ jsonMode: true, messages: [
      { role: 'system', content: `You propose prices; this model never authorizes a payment. ${instruction} ${style} Return ONLY one JSON object with keys action, priceMinor (decimal integer string for ACCEPT/COUNTER/PROPOSE; OMIT for REJECT), reason. reason is a short public summary, at most 500 characters. Never disclose the private capMinor or floorMinor in the public reason. Never output hidden reasoning, chain-of-thought, URLs, credentials, or extra keys. Monetary strings are exact minor units. Only the structured terms in the next message are relevant. You cannot change budgets or source policy. Negotiation has at most three rounds.` },
      { role: 'user', content: JSON.stringify({ role, ...terms }) },
    ] });
    if (!['0G', 'CLAUDE', 'OPENROUTER'].includes(output.provider) || typeof output.model !== 'string' || !output.model.trim() || output.model.length > 200 || typeof output.text !== 'string' || output.text.length > 4096) invalid();
    let value: unknown;
    try { value = JSON.parse(output.text); } catch { invalid(); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['action', 'priceMinor', 'reason'].includes(key))) invalid();
    const decision = value as Record<string, unknown>;
    if (typeof decision.action !== 'string' || typeof decision.reason !== 'string' || !decision.reason.trim() || decision.reason.length > 500 || Array.from(decision.reason).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) invalid();
    if (decision.action === 'REJECT') {
      if ('priceMinor' in decision) invalid();
      return { action: 'REJECT', reason: decision.reason, provider: output.provider as StrategyMetadata['provider'], model: output.model };
    }
    amount(decision.priceMinor);
    return { action: decision.action, priceMinor: decision.priceMinor as string, reason: decision.reason, provider: output.provider as StrategyMetadata['provider'], model: output.model };
  }
  async buyer(input: BuyerStrategyInput): Promise<BuyerDecision> {
    validateRound(input.round);
    const quote = amount(input.quoteMinor);
    const cap = amount(input.capMinor);
    const decision = await this.decide('BUYER', { quoteMinor: input.quoteMinor, capMinor: input.capMinor, round: input.round });
    if (decision.action === 'REJECT') return { ...decision, action: 'REJECT' };
    const price = amount(decision.priceMinor);
    if (price > cap) invalid();
    if (decision.action === 'ACCEPT' && price === quote) return { ...decision, action: 'ACCEPT' };
    if (decision.action === 'COUNTER' && price < quote) return { ...decision, action: 'COUNTER' };
    return invalid();
  }
  async seller(input: SellerStrategyInput): Promise<SellerDecision> {
    validateRound(input.round);
    const ask = amount(input.askMinor);
    const floor = amount(input.floorMinor);
    if (floor > ask || !['initial', 'counter'].includes(input.kind)) invalid();
    if (input.kind === 'counter') amount(input.incomingPriceMinor);
    if (input.kind === 'initial' && input.incomingPriceMinor !== undefined) invalid();
    const terms: SellerStrategyInput = { kind: input.kind, askMinor: input.askMinor, floorMinor: input.floorMinor, round: input.round, ...(input.incomingPriceMinor === undefined ? {} : { incomingPriceMinor: input.incomingPriceMinor }) };
    const decision = await this.decide('SELLER', terms);
    if (decision.action === 'REJECT') return { ...decision, action: 'REJECT' };
    const price = amount(decision.priceMinor);
    if (decision.action !== 'PROPOSE' || price < floor || price > ask) invalid();
    return { ...decision, action: 'PROPOSE' };
  }
}
