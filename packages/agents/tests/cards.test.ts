import { readFileSync } from 'node:fs';
import { AgentCard } from '@a2a-js/sdk';
import { expect, test } from 'vitest';

test('canonical provider cards parse with the official SDK and advertise distinct A2A endpoints', () => {
  const cards = ['provider-a', 'provider-b'].map(provider => {
    const raw: unknown = JSON.parse(readFileSync(new URL(`../../contracts/fixtures/${provider}.agent-card.json`, import.meta.url), 'utf8'));
    const card = AgentCard.fromJSON(raw);
    expect(card.name).toBe(provider);
    expect(card.supportedInterfaces).toHaveLength(1);
    expect(card.supportedInterfaces[0]?.protocolVersion).toBe('1.0');
    expect(card.supportedInterfaces[0]?.protocolBinding).toBe('JSONRPC');
    expect(card.skills.some(skill => skill.id === 'ETHEREUM_LENDING_LIQUIDITY')).toBe(true);
    expect(card.defaultInputModes).toContain('application/vnd.data-leases.negotiation+json;v=1');
    expect(card.description).toContain('DEMO_UNTRUSTED');
    return card;
  });
  expect(cards[0]?.supportedInterfaces[0]?.url).toBe('http://127.0.0.1:4101/a2a');
  expect(cards[1]?.supportedInterfaces[0]?.url).toBe('http://127.0.0.1:4102/a2a');
  expect(cards[0]?.supportedInterfaces[0]?.url).not.toBe(cards[1]?.supportedInterfaces[0]?.url);
});
