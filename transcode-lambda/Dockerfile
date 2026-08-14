# Container-image deployment for the ALIVE transcode Lambda.
#
# Replaces the zip-file deployment (see git history / TRANSCODE_LAMBDA.md's old
# "Package the Lambda" section): a from-scratch build of this function is ~53 MB
# zipped, mostly the ffmpeg/ffprobe static binaries, which is over the 50 MB cap on
# `aws lambda create-function --zip-file`'s direct-upload path. Container images have
# no such limit (up to 10 GB via ECR), so this sidesteps the problem entirely instead
# of routing around it with an S3-staged zip upload.
#
# The base image already bundles the Lambda Runtime Interface Client for Node, so
# `npm install` only needs the function's own dependencies -- and running that install
# INSIDE this image (linux/x64, matching the Lambda runtime) is what makes
# @ffmpeg-installer/ffmpeg and @ffprobe-installer/ffprobe select the correct
# platform-specific binaries automatically, the same guarantee the old Docker-based zip
# build was working around by hand.
FROM public.ecr.aws/lambda/nodejs:20

COPY package.json ${LAMBDA_TASK_ROOT}/
RUN npm install --omit=dev --prefix ${LAMBDA_TASK_ROOT}

# The @ffmpeg-installer / @ffprobe-installer binaries don't reliably carry an execute
# bit after `npm install`, and /var/task is READ-ONLY at Lambda runtime — so the
# installers' own require-time chmod fails and every job dies with
# "spawn .../ffprobe EACCES" (observed in prod: all transcodes stuck at status=error,
# no renditions ever produced). Set the bit here at build time, while the layer is
# still writable. chmod the whole installer trees so a platform-dir change can't regress.
RUN chmod -R +x ${LAMBDA_TASK_ROOT}/node_modules/@ffmpeg-installer \
                ${LAMBDA_TASK_ROOT}/node_modules/@ffprobe-installer

COPY index.mjs ${LAMBDA_TASK_ROOT}/

CMD ["index.handler"]
