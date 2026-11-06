export function readSimulationOutput(transcript: string): { requestSha256: string; result: unknown } {
  const lines = transcript.split('\n');
  const headers = lines.flatMap((line, index) => line.trim() === '✓ Workflow Simulation Result:' ? [index] : []);
  const returned = headers.length !== 1 ? undefined : lines.slice(headers[0]! + 1).find(line => line.trim().length > 0);
  if (!returned || !lines.some(line => /^\S+ \[SIMULATION\] Execution finished signal received\s*$/.test(line))) throw new Error('MISSING_CLI_COMPLETION_EVIDENCE');
  const decoded: unknown = JSON.parse(returned);
  if (typeof decoded !== 'string') throw new Error('INVALID_CLI_RETURN');
  const envelope: unknown = JSON.parse(decoded);
  if (typeof envelope !== 'object' || envelope === null || !('requestSha256' in envelope) ||
    typeof envelope.requestSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.requestSha256) || !('result' in envelope)) throw new Error('INVALID_CLI_RETURN');
  return { requestSha256: envelope.requestSha256, result: envelope.result };
}
