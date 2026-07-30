// Fires the content-transcode Lambda (see transcode-lambda/) and returns immediately —
// the Lambda calls back POST /api/admin/transcode-callback when it's done. Same
// "can't run ffmpeg on Vercel serverless" reasoning as remotion-render.ts, but this one
// doesn't poll: a transcode can take minutes for a 100 MB clip, well past what's
// worth blocking an admin-panel request on, so the callback pattern is used instead.

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

function transcodeConfigured(): boolean {
  return !!(process.env.TRANSCODE_LAMBDA_FUNCTION_NAME && process.env.TRANSCODE_LAMBDA_REGION);
}

export async function triggerTranscode(contentId: string, inputUrl: string): Promise<void> {
  if (!transcodeConfigured()) {
    throw new Error('Transcode Lambda not configured. Set TRANSCODE_LAMBDA_FUNCTION_NAME and TRANSCODE_LAMBDA_REGION.');
  }

  const client = new LambdaClient({
    region: process.env.TRANSCODE_LAMBDA_REGION,
    // Explicit creds only if set — falls back to the default provider chain
    // (e.g. a Vercel-attached IAM role) otherwise.
    ...(process.env.TRANSCODE_AWS_ACCESS_KEY_ID ? {
      credentials: {
        accessKeyId:     process.env.TRANSCODE_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.TRANSCODE_AWS_SECRET_ACCESS_KEY!,
      },
    } : {}),
  });
  await client.send(new InvokeCommand({
    FunctionName:   process.env.TRANSCODE_LAMBDA_FUNCTION_NAME,
    InvocationType: 'Event', // async — don't wait for the ffmpeg run to finish
    Payload:        Buffer.from(JSON.stringify({ contentId, inputUrl })),
  }));
}
