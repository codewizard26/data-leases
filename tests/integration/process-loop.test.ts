import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
test('two independent provider processes communicate with a separate buyer process', async () => {
 const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/demo.ts'], { timeout: 15000, env: { ...process.env, COMPUTE_PROVIDER: 'mock', DEMO_DYNAMIC_PORTS: 'true', NODE_ENV:'test',ALLOW_TEST_FIXTURES:'true' } });
 const listeningOrigins = [...stdout.matchAll(/provider ready: (http:\/\/127\.0\.0\.1:\d+)/g)].map(match => match[1]);
 expect(listeningOrigins).toHaveLength(2);
 expect(new Set(listeningOrigins).size).toBe(2);
 expect(listeningOrigins.every(origin => new URL(origin!).port !== '0')).toBe(true);
 expect(stdout).toContain('"status": "AGREED"');
 expect(stdout).toContain('"priceMinor": "350"');
 expect(stdout).toContain('"status": "REJECTED"');
 expect(stdout).toContain('"action": "COUNTER"');
}, 20000);
