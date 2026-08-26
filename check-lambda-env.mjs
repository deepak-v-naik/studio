#!/usr/bin/env node
// Reads the alive-transcode Lambda's env config to diagnose the "Invalid URL" failure.
// Prints keys, value lengths, and URL-parse verdicts — values themselves only for
// non-secret vars (endpoint/bucket/base/callback URL).
import 'dotenv/config';
import { LambdaClient, GetFunctionConfigurationCommand } from '@aws-sdk/client-lambda';

const client = new LambdaClient({
  region: process.env.TRANSCODE_LAMBDA_REGION,
  credentials: {
    accessKeyId: process.env.TRANSCODE_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.TRANSCODE_AWS_SECRET_ACCESS_KEY,
  },
});
const cfg = await client.send(new GetFunctionConfigurationCommand({ FunctionName: process.env.TRANSCODE_LAMBDA_FUNCTION_NAME }));
const env = cfg.Environment?.Variables ?? {};
const NONSECRET = new Set(['R2_ENDPOINT', 'R2_BUCKET', 'R2_PUBLIC_BASE', 'STUDIO_CALLBACK_URL']);
for (const [k, v] of Object.entries(env)) {
  let verdict = '';
  if (/URL|ENDPOINT|BASE/.test(k)) {
    try { new URL(v); verdict = 'parses-ok'; } catch { verdict = '*** INVALID URL ***'; }
  }
  console.log(`${k}: len=${v.length}${NONSECRET.has(k) ? ` value=${JSON.stringify(v)}` : ''} ${verdict}`);
}
console.log('---');
console.log(`State: ${cfg.State}  LastUpdateStatus: ${cfg.LastUpdateStatus}  Timeout: ${cfg.Timeout}s  Memory: ${cfg.MemorySize}MB  Storage: ${cfg.EphemeralStorage?.Size}MB`);
