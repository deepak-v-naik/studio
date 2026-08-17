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

### 1. Build the container image

Deployed as a container image, not a zip. A from-scratch build of this
function is ~53 MB zipped (mostly the ffmpeg/ffprobe static binaries) — over
the 50 MB cap on `aws lambda create-function --zip-file`'s direct-upload
path, which fails with `RequestEntityTooLargeException` regardless of who
builds it or how. Container images have no such limit (up to 10 GB via ECR),
so this sidesteps the problem instead of routing around it with an
S3-staged zip upload.

`transcode-lambda/Dockerfile` is checked in — `docker build` is all that's
needed, and running `npm install` *inside* the image (matching the Lambda
runtime's linux/x64) is what makes `@ffmpeg-installer/ffmpeg` and
`@ffprobe-installer/ffprobe` select the correct platform binaries
automatically. Verified: booted the image locally with AWS's Lambda Runtime
Interface Emulator and confirmed the handler's download → ffmpeg → callback
path executes (see "Testing it" below for the same check on your machine).

```bash
cd transcode-lambda
docker build -t alive-transcode .
```

### 2. Push to ECR and create the Lambda function

```bash
# One-time: create the ECR repository
aws ecr create-repository --repository-name alive-transcode --region ap-south-1

# Authenticate Docker to ECR, tag, and push
aws ecr get-login-password --region ap-south-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-south-1.amazonaws.com

docker tag alive-transcode:latest \
  <account-id>.dkr.ecr.ap-south-1.amazonaws.com/alive-transcode:latest
docker push <account-id>.dkr.ecr.ap-south-1.amazonaws.com/alive-transcode:latest

aws lambda create-function \
  --function-name alive-transcode \
  --package-type Image \
  --code ImageUri=<account-id>.dkr.ecr.ap-south-1.amazonaws.com/alive-transcode:latest \
  --role arn:aws:iam::<account-id>:role/alive-transcode-role \
  --timeout 300 \
  --memory-size 2048 \
  --ephemeral-storage '{"Size": 2048}' \
  --region ap-south-1
```

For every future update: **automatic** — the
`.github/workflows/transcode-lambda-deploy.yml` workflow rebuilds, pushes to
ECR, and updates the function on every push to `main` that touches
`transcode-lambda/` (needs `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` repo
secrets; can also be run manually from the Actions tab). The manual path still
works and stays interchangeable: rebuild, `docker push` the same tag (or a new
one), then `aws lambda update-function-code --function-name alive-transcode
--image-uri <the-uri>`.

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

### Locally, before touching AWS

The `public.ecr.aws/lambda/nodejs:20` base image includes the Lambda Runtime
Interface Emulator, so the built image can be invoked exactly like Lambda
would, on your machine:

```bash
docker run --rm -p 9000:8080 alive-transcode

# separate terminal
curl -X POST "http://localhost:9000/2015-03-31/functions/function/invocations" \
  -d '{"contentId": "test", "inputUrl": "https://example.com/some-video.mp4"}'
```

This proves the runtime boots and the handler's download → ffmpeg →
R2-upload → callback path executes — set `R2_*`/`STUDIO_CALLBACK_URL`/
`TRANSCODE_CALLBACK_SECRET` as `-e` flags on the `docker run` to exercise it
end-to-end with a real video and a real callback. Without them, a real
`inputUrl` will still transcode and upload to R2 correctly; only the final
callback step will report the missing env var, which is expected.

### Against the deployed Lambda

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
