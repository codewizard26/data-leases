import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { VerificationRequestSchema, type VerificationRequest } from '@data-leases/contracts';

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
export function requestDigest(request: VerificationRequest): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonical(VerificationRequestSchema.parse(request)))));
}
