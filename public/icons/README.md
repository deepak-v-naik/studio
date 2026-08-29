# PWA + notification icons

These are **generated**, not hand-drawn. Regenerate with:

```
node scripts/generate-icons.mjs
```

## Files

| File                     | Size    | Purpose                                             |
|--------------------------|---------|-----------------------------------------------------|
| `icon-192.png`           | 192×192 | Android home screen; notification large icon        |
| `icon-512.png`           | 512×512 | Android splash / install prompt                     |
| `icon-maskable-192.png`  | 192×192 | Android adaptive icon                               |
| `icon-maskable-512.png`  | 512×512 | Android adaptive icon                               |
| `apple-touch-icon.png`   | 180×180 | iOS home screen (opaque — iOS composites alpha onto black) |
| `badge-96.png`           | 96×96   | Android notification badge (status bar)             |

Referenced from `src/app/manifest.ts` (the four PWA icons), `src/app/layout.tsx`
(apple-touch-icon), and `public/sw.js` (`icon` + `badge` on push notifications).
Adding or renaming a file means updating those too.

## Design notes

The mark is the **ALIVE dot** — the same motif as `public/favicon.svg` — not the
"alive" wordmark. The wordmark is Poppins ExtraBold, which isn't guaranteed to be
installed wherever this script runs, and a fallback face renders visibly
off-brand. The dot is font-free, so output is byte-identical on any machine, and
it stays legible at the ~24dp Android draws a notification icon at, where a
wordmark would be unreadable.

Two families, and they are not interchangeable:

- **any** — white field, red dot. Shown as-is.
- **maskable** — red bleeding to all four edges, white dot kept well inside the
  safe zone. Android crops adaptive icons to a circle/squircle; a white-background
  icon gets its corners clipped and looks broken, which is exactly what the
  maskable variants exist to prevent.

`badge-96.png` is white-on-transparent because Android alpha-masks the badge to a
silhouette and discards colour. Pointing `badge` at a white-background icon (as
the SW briefly did) masks to a solid blob.
