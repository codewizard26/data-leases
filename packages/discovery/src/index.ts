import { createHash } from 'node:crypto';
import type { DiscoveryQuery, DiscoveredAgent } from '@data-leases/contracts';

/** This initial adapter deliberately accepts only explicitly configured local services. */
export interface LocalDiscoveryPolicy {
  allowedCardUrls: readonly string[];
  allowedEndpointUrls: readonly string[];
  timeoutMs?: number;
  maxBytes?: number;
}
export interface DiscoveryAdapter {
  discover(input: DiscoveryQuery): Promise<DiscoveredAgent[]>;
}
export interface LocalAgentCard {
  name: string;
  version: string;
  supportedInterfaces: { url: string; protocolBinding: string; protocolVersion: string }[];
  skills: { id: string }[];
}
function allowedLocalUrl(value: string, allowlist: readonly string[]): URL {
  const url = new URL(value);
  if (!allowlist.includes(value) || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      !url.port || url.username || url.password || url.search || url.hash || url.href !== value) {
    throw new Error('Local discovery URL not allowed');
  }
  return url;
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseCard(value: unknown): LocalAgentCard {
  if (!object(value) || typeof value.name !== 'string' || !value.name || typeof value.version !== 'string' ||
      !Array.isArray(value.supportedInterfaces) || !value.supportedInterfaces.length ||
      !value.supportedInterfaces.every(item => object(item) && typeof item.url === 'string' &&
        item.protocolBinding === 'JSONRPC' && item.protocolVersion === '1.0') ||
      !Array.isArray(value.skills) || !value.skills.every(item => object(item) && typeof item.id === 'string')) {
    throw new Error('Invalid local A2A v1 card');
  }
  return value as unknown as LocalAgentCard;
}
export async function fetchLocalAgentCard(cardUrl: string, policy: LocalDiscoveryPolicy): Promise<{
  card: LocalAgentCard; cardFingerprintSha256: string;
}> {
  allowedLocalUrl(cardUrl, policy.allowedCardUrls);
  const timeoutMs = policy.timeoutMs ?? 5_000;
  const maxBytes = policy.maxBytes ?? 65_536;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_048_576) throw new Error('Invalid discovery limits');
  const response = await fetch(cardUrl, {redirect: 'error', signal: AbortSignal.timeout(timeoutMs)});
  if (!response.ok || !response.body) throw new Error('Agent card fetch failed');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error('Agent card exceeds size limit');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  const raw = Buffer.concat(chunks);
  const card = parseCard(JSON.parse(raw.toString('utf8')));
  for (const endpoint of card.supportedInterfaces) allowedLocalUrl(endpoint.url, policy.allowedEndpointUrls);
  return { card, cardFingerprintSha256: createHash('sha256').update(raw).digest('hex') };
}
async function discoverCard(cardUrl: string, input: DiscoveryQuery, policy: LocalDiscoveryPolicy,
  source: 'DIRECT_URL' | 'LOCAL_REGISTRY'): Promise<DiscoveredAgent> {
  const {card, cardFingerprintSha256} = await fetchLocalAgentCard(cardUrl, policy);
  const endpoint = card.supportedInterfaces[0];
  if (!endpoint) throw new Error('Agent card has no endpoint');
  return {providerId: card.name, displayName: card.name, cardUrl, a2aEndpoint: endpoint.url,
    supportedQuestionTemplates: card.skills.map(skill => skill.id), discoverySource: source,
    cardFingerprintSha256, fetchedAt: new Date().toISOString(),
    capabilityMatched: card.skills.some(skill => skill.id === input.questionTemplateId)};
}
export class DirectUrlDiscovery implements DiscoveryAdapter {
  constructor(private readonly policy: LocalDiscoveryPolicy) {}
  async discover(input: DiscoveryQuery): Promise<DiscoveredAgent[]> {
    if (input.mode !== 'DIRECT_URL') throw new Error('Unsupported discovery mode');
    if (!input.directCardUrl) throw new Error('directCardUrl is required');
    return [await discoverCard(input.directCardUrl, input, this.policy, 'DIRECT_URL')];
  }
}
export class LocalRegistryDiscovery implements DiscoveryAdapter {
  constructor(private readonly cardUrls: readonly string[], private readonly policy: LocalDiscoveryPolicy) {}
  async discover(input: DiscoveryQuery): Promise<DiscoveredAgent[]> {
    if (input.mode !== 'LOCAL_REGISTRY') throw new Error('Unsupported discovery mode');
    return Promise.all([...new Set(this.cardUrls)].map(url => discoverCard(url, input, this.policy, 'LOCAL_REGISTRY')));
  }
}
