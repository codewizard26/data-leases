import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/** External verification identifiers are metadata, never filesystem path components. */
export function artifactPaths(outputDirectory: string, verificationId: string): { log: string; artifact: string } {
  const basename = createHash('sha256').update(verificationId).digest('hex');
  return {
    log: resolve(outputDirectory, `${basename}.log`),
    artifact: resolve(outputDirectory, `${basename}.artifact.json`),
  };
}
