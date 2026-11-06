import { describe, expect, test } from 'vitest';
import { MockComputeAdapter, ZeroGComputeAdapter, OpenRouterComputeAdapter, createComputeAdapter } from '../src/compute.js';

const options = { baseUrl: 'https://provider.example/v1/proxy', apiKey: 'app-sk-private', model: 'test-model' };
const input = { messages: [{ role: 'user' as const, content: 'Explain the proposed terms.' }] };

describe('compute adapters', () => {
  test('mock returns explicitly labeled deterministic output', async () => {
    const adapter = new MockComputeAdapter();
    expect(await adapter.generate(input)).toEqual(await adapter.generate(input));
    expect((await adapter.generate(input)).provider).toBe('MOCK');
  });
  test('0G sends documented bearer-authenticated chat request', async () => {
    let request: Request | undefined;
    const adapter = new ZeroGComputeAdapter(options, async (url, init) => {
      request = new Request(url, init);
      return Response.json({ choices: [{ message: { content: 'Terms summarized.' } }] });
    });
    expect(await adapter.generate(input)).toEqual({ provider: '0G', model: 'test-model', text: 'Terms summarized.' });
    expect(request?.url).toBe('https://provider.example/v1/proxy/chat/completions');
    expect(request?.headers.get('authorization')).toBe('Bearer app-sk-private');
    expect(await request?.json()).toEqual({ model: 'test-model', messages: input.messages, max_tokens: 256, temperature: 0 });
  });
  test('upstream failures never expose response bodies or secrets', async () => {
    const adapter = new ZeroGComputeAdapter(options, async () => new Response('app-sk-private leaked', { status: 401 }));
    await expect(adapter.generate(input)).rejects.toThrow('COMPUTE_HTTP_401');
    await expect(adapter.generate(input)).rejects.not.toThrow('app-sk-private');
  });
  test('rejects malformed or oversized completions', async () => {
    await expect(new ZeroGComputeAdapter(options, async () => Response.json({ choices: [] })).generate(input)).rejects.toThrow('COMPUTE_INVALID_RESPONSE');
    await expect(new ZeroGComputeAdapter(options, async () => new Response('x'.repeat(65537))).generate(input)).rejects.toThrow('COMPUTE_RESPONSE_TOO_LARGE');
  });
  test('requires HTTPS and rejects credentials and invalid timeout', () => {
    for (const baseUrl of ['http://provider.example/v1/proxy', 'https://user:secret@provider.example/v1/proxy', 'https://provider.example/other']) {
      expect(() => new ZeroGComputeAdapter({ ...options, baseUrl })).toThrow('COMPUTE_INVALID_CONFIG');
    }
    expect(() => new ZeroGComputeAdapter({ ...options, timeoutMs: 0 })).toThrow('COMPUTE_INVALID_CONFIG');
  });
  test('timeout aborts request and returns sanitized failure', async () => {
    const adapter = new ZeroGComputeAdapter({ ...options, timeoutMs: 5 }, async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('sensitive upstream detail')));
    }));
    await expect(adapter.generate(input)).rejects.toThrow('COMPUTE_UNAVAILABLE');
  });
  test('environment factory defaults to mock and fails closed for unsupported or incomplete providers', () => {
    expect(createComputeAdapter({})).toBeInstanceOf(MockComputeAdapter);
    expect(() => createComputeAdapter({ COMPUTE_PROVIDER: 'claude' })).toThrow('COMPUTE_PROVIDER_NOT_IMPLEMENTED');
    expect(() => createComputeAdapter({ COMPUTE_PROVIDER: '0g' })).toThrow('COMPUTE_INVALID_CONFIG');
  });
});

describe('OpenRouter free compute', () => {
  test('uses fixed endpoint, free model and actual returned model', async () => {
    let request: Request | undefined;
    const adapter = new OpenRouterComputeAdapter({ apiKey: 'private-key' }, async (url, init) => {
      request = new Request(url, init);
      return Response.json({ model: 'vendor/model:free', choices: [{ message: { content: 'Free response' } }] });
    });
    expect(await adapter.generate(input)).toEqual({ provider: 'OPENROUTER', model: 'vendor/model:free', text: 'Free response' });
    expect(request?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(request?.headers.get('authorization')).toBe('Bearer private-key');
    expect(await request?.json()).toEqual({ model: 'openrouter/free', messages: input.messages, max_tokens: 1024, temperature: 0 });
  });
  test('rejects paid, empty and malformed model selectors', () => {
    for (const model of ['anthropic/claude-sonnet-4', '', 'openrouter/auto', 'vendor/model:free ', ':free', 'https://evil.example/:free']) {
      expect(() => new OpenRouterComputeAdapter({ apiKey: 'key', model })).toThrow('COMPUTE_FREE_MODEL_REQUIRED');
    }
  });
  test('factory selects OpenRouter and missing credentials fail closed', () => {
    expect(createComputeAdapter({ COMPUTE_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'key' })).toBeInstanceOf(OpenRouterComputeAdapter);
    expect(() => createComputeAdapter({ COMPUTE_PROVIDER: 'openrouter' })).toThrow('COMPUTE_INVALID_CONFIG');
  });
  test('rate limit failures are sanitized without retries', async () => {
    let calls = 0;
    const adapter = new OpenRouterComputeAdapter({ apiKey: 'private-key', model: 'vendor/model:free' }, async () => {
      calls++;
      return new Response('private-key upstream detail', { status: 429 });
    });
    await expect(adapter.generate(input)).rejects.toThrow('COMPUTE_HTTP_429');
    expect(calls).toBe(1);
  });
  test('validates malformed completion and enforces response size', async () => {
    await expect(new OpenRouterComputeAdapter({ apiKey: 'key' }, async () => Response.json({ choices: [] })).generate(input)).rejects.toThrow('COMPUTE_INVALID_RESPONSE');
    await expect(new OpenRouterComputeAdapter({ apiKey: 'key' }, async () => new Response('x'.repeat(65537))).generate(input)).rejects.toThrow('COMPUTE_RESPONSE_TOO_LARGE');
  });
});
test('OpenRouter JSON mode requests structured content without hidden reasoning', async () => {
 let body: Record<string, unknown> | undefined;
 const adapter = new OpenRouterComputeAdapter({ apiKey: 'key', model: 'liquid/lfm-2.5-2.6b:free' }, async (_url, init) => {
  body = JSON.parse(String(init?.body));
  return Response.json({ choices: [{ message: { content: '{"action":"REJECT","reason":"No agreement."}' } }] });
 });
 await adapter.generate({ ...input, jsonMode: true });
 expect(body?.response_format).toEqual({ type: 'json_object' });
 expect(body?.reasoning).toEqual({ exclude: true });
 expect(body?.max_tokens).toBe(2048);
});
test('0G JSON mode requests structured content without OpenRouter reasoning parameter', async () => {
 let body: Record<string, unknown> | undefined;
 const adapter = new ZeroGComputeAdapter(options, async (_url, init) => {
  body = JSON.parse(String(init?.body));
  return Response.json({ choices: [{ message: { content: '{}' } }] });
 });
 await adapter.generate({ ...input, jsonMode: true });
 expect(body?.response_format).toEqual({ type: 'json_object' });
 expect(body?.reasoning).toBeUndefined();
});
