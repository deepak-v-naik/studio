# R2 bucket CORS — required for large media uploads

Admin content uploads go **browser → R2 directly** via a presigned PUT
(`src/components/admin/content-tab.tsx` → `GET /api/admin/r2-upload` → `PUT <uploadUrl>`).

This is deliberate. Vercel caps a serverless function's **request body at ~4.5 MB** on
every plan, so any upload that passes *through* a function is stuck under that ceiling no
matter how the limit constant is set — upgrading the Vercel plan does not raise it. Sending
the bytes straight to R2 removes the function from the data path entirely, which is what
allows the 100 MB limit (a 30s 4K clip).

The tradeoff: a cross-origin `PUT` from the browser requires CORS on the bucket. Without
it, the upload fails at preflight with a generic network error and **no HTTP status** — the
admin UI calls this out explicitly, but the fix is here.

## One-time setup

Cloudflare dashboard → **R2** → your bucket → **Settings** → **CORS policy** → add:

```json
[
  {
    "AllowedOrigins": [
      "https://wearealive.in",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Notes:

- `AllowedHeaders` must include `Content-Type`. The presigned signature covers that header,
  so the browser sends it and the preflight must permit it.
- Add any Vercel preview domain you upload from; origins are matched exactly, and a preview
  deployment on a different hostname will fail preflight otherwise.
- Keep `localhost:3000` only if you upload from a local dev server.

## Verifying

Upload a >5 MB video in admin → Content. Previously this failed at ~4.5 MB with a 413
regardless of the client-side limit. If it now fails with a network error and no status,
CORS is still not applied — re-check the origin list matches the URL in your address bar.

## Server-side proxy is still used elsewhere

`POST /api/admin/r2-upload` (the FormData proxy) remains for small server-side uploads —
e.g. store-partner KYC documents via `/api/stores/upload`, which are phone photos well
under the cap and benefit from not needing CORS. Only the admin content uploader switched
to presigned PUT.
