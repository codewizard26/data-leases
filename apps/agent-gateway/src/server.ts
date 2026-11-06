import { randomUUID } from 'node:crypto';
import { MockVerificationClient } from '@data-leases/cre-adapter';
import { VerificationRequestSchema, VerificationResultSchema, type AnswerEnvelope, type VerificationResult } from '@data-leases/contracts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { createComputeAdapter, negotiate, DEMO_SCENARIOS, QUESTION_TEMPLATE } from '@data-leases/agents';

export interface GatewayOptions {
  port?: number;
  providerOrigins?: readonly string[];
}
class RequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  response.end(JSON.stringify(body));
}
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new RequestError(415, 'JSON_REQUIRED');
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    bytes += chunk.byteLength;
    if (bytes > 8192) throw new RequestError(413, 'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RequestError(400, 'INVALID_JSON'); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new RequestError(400, 'INVALID_INPUT');
  return value as Record<string, unknown>;
}
function localOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('INVALID_LOCAL_PROVIDER_ORIGIN');
  return url.origin;
}
/** The live demo intentionally supplies no independent evidence to the mock verifier. */
async function verifyDeliveredAnswer(answer: AnswerEnvelope): Promise<VerificationResult> {
  const verificationId = randomUUID();
  try {
    const input = VerificationRequestSchema.parse({schemaVersion:'1.0.0', verificationId,
      runId:answer.runId, sessionId:answer.sessionId, providerId:answer.providerId,
      questionTemplateId:answer.questionTemplateId, answer,
      policy:{policyId:answer.evidencePolicyId,version:'1.0.0',allowedChainIds:[answer.chainId],
        allowedMetricIds:[answer.metric],maxAgeSeconds:60,maxAbsDeltaRaw:'0'},
      requestedAt:new Date().toISOString()});
    const client = new MockVerificationClient();
    await client.submit(input);
    const result = await client.getResult(verificationId);
    if (!result) throw new Error('VERIFICATION_RESULT_UNAVAILABLE');
    return VerificationResultSchema.parse(result);
  } catch {
    // Keep the delivered answer even if the adapter cannot evaluate it.
    return VerificationResultSchema.parse({schemaVersion:'1.0.0',verificationId,runId:answer.runId,
      providerId:answer.providerId,executionMode:'MOCK',status:'INCONCLUSIVE',
      checks:[{checkId:'VERIFICATION_ADAPTER_AVAILABLE',status:'UNKNOWN',reasonCode:'ADAPTER_UNAVAILABLE'}],
      executedAt:new Date().toISOString(),evidenceRefs:[]});
  }
}
export async function startGateway(options: GatewayOptions = {}) {
  const origins = options.providerOrigins ?? ['http://127.0.0.1:4101', 'http://127.0.0.1:4102'];
  if (origins.length !== 2) throw new Error('TWO_PROVIDER_ORIGINS_REQUIRED');
  const providers = origins.map((origin, index) => ({providerId: index === 0 ? 'provider-a' : 'provider-b', origin: localOrigin(origin)}));
  let baseUrl = '';
  let computeInFlight = false;
  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('Connection', 'close');
    const authority = new URL(baseUrl).host;
    const localhostAuthority = authority.replace('127.0.0.1', 'localhost');
    if (request.headers.host !== authority && request.headers.host !== localhostAuthority) throw new RequestError(403, 'HOST_NOT_ALLOWED');
    const path = new URL(request.url ?? '/', baseUrl).pathname;
    if (request.method === 'GET' && path === '/api/health') {
      const provider = process.env.COMPUTE_PROVIDER ?? 'mock';
      const model = provider === 'mock' ? 'deterministic' : provider === 'openrouter' ? (process.env.OPENROUTER_MODEL ?? 'openrouter/free') : (process.env.ZERO_G_MODEL ?? 'not-configured');
      json(response, 200, {status:'ok', compute:{provider: ['0g', 'mock', 'openrouter'].includes(provider) ? provider : 'unsupported', model: /^[a-zA-Z0-9._:/-]{1,100}$/.test(model) ? model : 'configured'}, providers});
      return;
    }
    if (request.method === 'GET' && path === '/api/templates') {
      json(response, 200, {templates: DEMO_SCENARIOS}); return;
    }
    if (request.method === 'GET' && ['/', '/demo', '/demo/'].includes(path)) {
      const html = await readFile(new URL(path === '/' ? '../../web/landing.html' : '../../web/index.html', import.meta.url));
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});
      response.end(html); return;
    }
    if (request.method !== 'POST' || !['/api/negotiate', '/api/compute'].includes(path)) throw new RequestError(404, 'NOT_FOUND');
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== baseUrl && origin !== baseUrl.replace('127.0.0.1','localhost')) throw new RequestError(403, 'ORIGIN_NOT_ALLOWED');
    const body = await readBody(request);
    if (path === '/api/negotiate') {
      if (Object.keys(body).some(key => !['maxPriceMinor','questionTemplateId'].includes(key)) || typeof body.maxPriceMinor !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(body.maxPriceMinor)) throw new RequestError(400, 'INVALID_PRICE');
      const questionTemplateId = body.questionTemplateId === undefined ? QUESTION_TEMPLATE : body.questionTemplateId;
      if (typeof questionTemplateId !== 'string' || (questionTemplateId !== QUESTION_TEMPLATE && !DEMO_SCENARIOS.some(item => item.questionTemplateId === questionTemplateId))) throw new RequestError(400, 'INVALID_QUESTION_TEMPLATE');
      const maxPriceMinor = body.maxPriceMinor;
      const results = await Promise.all(providers.map(async provider => {
        const connection = {providerId:provider.providerId, cardUrl:`${provider.origin}/.well-known/agent-card.json`, a2aEndpoint:`${provider.origin}/a2a`, protocol:'A2A 1.0 JSONRPC', discoverySource:'LOCAL_REGISTRY'};
        try {
          const result = await negotiate({baseUrl:provider.origin, providerId:provider.providerId, maxPriceMinor, questionTemplateId});
          const verification = result.answer ? await verifyDeliveredAnswer(result.answer) : undefined;
          return {...connection, ...result, ...(verification ? {verification} : {}), stages:{discovery:'DISCOVERED', negotiation:result.status, answer:result.answer ? 'DELIVERED_UNVERIFIED' : 'NOT_REQUESTED', verification:verification ? `${verification.executionMode}:${verification.status}` : 'NOT_REQUESTED', payment:'DISABLED'}};
        }
        catch { return {...connection, status:'FAILED', error:'NEGOTIATION_FAILED', transcript:[], stages:{discovery:'UNKNOWN', negotiation:'FAILED', answer:'NOT_REQUESTED', verification:'NOT_REQUESTED', payment:'DISABLED'}}; }
      }));
      json(response, 200, {results}); return;
    }
    if (Object.keys(body).length !== 1 || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 4000) throw new RequestError(400, 'INVALID_PROMPT');
    if (computeInFlight) throw new RequestError(429, 'COMPUTE_BUSY');
    computeInFlight = true;
    try {
      const adapter = createComputeAdapter();
      const result = await adapter.generate({messages:[{role:'user',content:body.prompt}]});
      json(response, 200, result);
    } catch (error) {
      if (error instanceof Error && error.message === 'COMPUTE_HTTP_429') throw new RequestError(429, 'COMPUTE_RATE_LIMITED');
      if (error instanceof Error && error.message === 'COMPUTE_HTTP_401') throw new RequestError(502, 'COMPUTE_AUTH_FAILED');
      throw new RequestError(502, 'COMPUTE_UNAVAILABLE');
    }
    finally { computeInFlight = false; }
  };
  const server = createServer((request, response) => {
    void handler(request, response).catch(error => {
      if (!response.headersSent) json(response, error instanceof RequestError ? error.status : 500, {error:error instanceof RequestError ? error.code : 'REQUEST_FAILED'});
      else response.end();
    });
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once('error',reject);server.listen(options.port ?? 3000,'127.0.0.1',resolve); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {baseUrl, close: () => new Promise<void>((resolve, reject) => {server.close(error => error ? reject(error) : resolve());server.closeAllConnections();})};
}
