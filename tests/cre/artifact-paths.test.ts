import { expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import * as artifacts from '../../packages/cre-adapter/scripts/artifact-paths.js';
it('hashes verification IDs into artifact names contained in the output directory', () => {
 const output = '/private/tmp/cre-artifacts';
 for (const verificationId of ['normal-id', '../../../escape', '/private/tmp/absolute', '..\\escape']) {
  const paths = artifacts.artifactPaths(output, verificationId);
  expect(dirname(paths.log)).toBe(resolve(output));
  expect(dirname(paths.artifact)).toBe(resolve(output));
  expect(paths.log).toMatch(/[0-9a-f]{64}\.log$/);
  expect(paths.artifact).toMatch(/[0-9a-f]{64}\.artifact\.json$/);
  expect(paths).toEqual(artifacts.artifactPaths(output, verificationId));
 }
 expect(artifacts.artifactPaths(output, 'a')).not.toEqual(artifacts.artifactPaths(output, 'b'));
});
