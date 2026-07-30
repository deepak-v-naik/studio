# Content transcode Lambda

Automatically re-encodes every uploaded video to **H.264, Main Profile, Level
4.1** — a profile/level virtually every Android TV hardware decoder (Realtek,
Amlogic, Allwinner, MediaTek) supports. This exists because a field TV
(Kodak-branded box, `OMX.realtek.video.decoder`) rejected a High Profile /
Level 5.0 source at `MediaCodec` init time even though ExoPlayer's
format-support pre-check reported it as playable — a known Realtek OMX
capability-reporting quirk, not an app bug. See `transcode-lambda/index.mjs`
for the full failure-mode writeup.

## Why Lambda (same reasoning as Remotion — see REMOTION.md)

ffmpeg can't run on Vercel serverless: the binary is too large to bundle and
a multi-minute transcode of a 100 MB clip exceeds Vercel's function time
limits. The actual encode runs on AWS Lambda, which has no such ceiling.

## How it fits together

1. Admin uploads a video in the Content tab → `content-tab.tsx` finishes the
   direct-to-R2 upload, then calls `POST /api/admin/transcode { contentId }`
   and moves on (fire-and-forget, no UI blocking).
2. That route (`src/app/api/admin/transcode/route.ts`) marks the `Content`
   row `transcodeStatus: 'pending'` and invokes the Lambda **asynchronously**
   (`InvocationType: 'Event'`) with `{ contentId, inputUrl }`.
3. The Lambda (`transcode-lambda/index.mjs`) downloads the original,
   re-encodes with ffmpeg, uploads the result to R2 under a **new** object
   key + hash, then calls back `POST /api/admin/transcode-callback` with the
   result.
4. The callback route updates the `Content` row (`objectKey`, `md5`,
   `sizeBytes`, `durationMs`, `width`, `height`, `transcodeStatus: 'done'`).
   Because the object key and hash both change, any device that already
   cached the original under its old hash is unaffected until its next
   normal plan fetch — at which point it sees a changed hash and downloads
   the new file, exactly like any other content update.

A "transcoding…" badge shows in the Content tab while `transcodeStatus` is
`pending`, and the admin panel polls quietly until it flips to `done`/`error`.

## One-time setup (operator, not done at runtime)

### 1. Package the Lambda

The npm packages `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe`
bundle prebuilt static binaries selected by `process.platform`/`arch` at
**install time** — so `npm install` for this function must run on
**linux/x64** (matching the Lambda runtime), not on your Mac/Windows laptop.
Easiest: build inside a matching container.

```bash
cd transcode-lambda
docker run --rm -v "$PWD":/var/task -w /var/task \
  public.ecr.aws/sam/build-nodejs20.x \
  npm install --omit=dev
zip -r function.zip index.mjs node_modules package.json
```

### 2. Create the Lambda function

```bash
aws lambda create-function \
  --function-name alive-transcode \
  --runtime nodejs20.x \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --role arn:aws:iam::<account-id>:role/alive-transcode-role \
  --timeout 300 \
  --memory-size 2048 \
  --ephemeral-storage '{"Size": 2048}' \
  --region ap-south-1
```

- **Memory 2048 MB minimum** — Lambda allocates CPU proportional to memory,
  and ffmpeg needs real CPU to transcode in reasonable time.
- **Timeout 300s+** — a few minutes for a ~100 MB clip; raise further if you
  regularly upload longer/larger source files.
- **Ephemeral storage (/tmp) 2048 MB+** — holds the original and re-encoded
  file simultaneously.
- The execution role needs no special permissions beyond the default Lambda
  basic execution policy (CloudWatch Logs) — R2 access uses plain access-key
  credentials passed as env vars below, not IAM.

### 3. Configure the Lambda's own environment variables

```bash
aws lambda update-function-configuration \
  --function-name alive-transcode \
  --environment "Variables={
    R2_ENDPOINT=<your R2 S3-compatible endpoint>,
    R2_ACCESS_KEY_ID=<R2 access key>,
    R2_SECRET_ACCESS_KEY=<R2 secret key>,
    R2_BUCKET=<bucket name>,
    STUDIO_CALLBACK_URL=https://<your-studio-domain>/api/admin/transcode-callback,
    TRANSCODE_CALLBACK_SECRET=<generate with: openssl rand -hex 32>
  }"
```

Use the **same R2 credentials/bucket** the studio app already uses (`R2_*`
env vars in `.env.example`) — the Lambda just needs write access to upload
the re-encoded file back to the same bucket.

### 4. Configure the studio app's environment variables

Add to your Vercel project (and local `.env`):

```
TRANSCODE_LAMBDA_FUNCTION_NAME=alive-transcode
TRANSCODE_LAMBDA_REGION=ap-south-1
TRANSCODE_AWS_ACCESS_KEY_ID=<IAM user/key with lambda:InvokeFunction on alive-transcode>
TRANSCODE_AWS_SECRET_ACCESS_KEY=<...>
TRANSCODE_CALLBACK_SECRET=<same value as step 3>
```

The IAM credentials only need `lambda:InvokeFunction` scoped to the
`alive-transcode` function ARN — reuse the Remotion Lambda IAM user if it
already has broad `lambda:InvokeFunction`, or create a narrowly-scoped one.

### 5. Apply the database migration

Already checked in at
`prisma/migrations/20260730000000_content_transcode_status/` — runs
automatically via `prisma migrate deploy` in the build script (see
`package.json`). No manual step needed beyond a normal deploy.

## Testing it

1. Upload a video in the admin Content tab.
2. Confirm the "transcoding…" badge appears, then clears within a few
   minutes (check CloudWatch Logs for `alive-transcode` if it doesn't, or if
   a "transcode failed" badge appears instead — hover it for the error).
3. Confirm the video still plays correctly in the playlist preview and on a
   real device afterward.

## Re-running on already-uploaded content

For videos uploaded before this pipeline existed, trigger a re-encode
manually:

```bash
curl -X POST https://<your-studio-domain>/api/admin/transcode \
  -H "admin-password: <ADMIN_PASSWORD>" \
  -H "content-type: application/json" \
  -d '{"contentId": "<content id from the admin panel URL/API>"}'
```
