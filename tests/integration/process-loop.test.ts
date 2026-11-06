import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
test('two independent provider processes communicate with a separate buyer process', async () => {
 const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/demo.ts'], { timeout: 15000, env: { ...process.env, COMPUTE_PROVIDER: 'mock' } });
 expect(stdout).toContain('provider ready: http://127.0.0.1:4101');
 expect(stdout).toContain('provider ready: http://127.0.0.1:4102');
 expect(stdout).toContain('"status": "AGREED"');
 expect(stdout).toContain('"priceMinor": "350"');
 expect(stdout).toContain('"status": "REJECTED"');
 expect(stdout).toContain('"action": "COUNTER"');
}, 20000);
