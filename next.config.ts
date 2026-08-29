import type {NextConfig} from 'next';

// Security headers applied to every response. `frame-ancestors 'none'` blocks
// clickjacking of the admin console (whose credential lives in sessionStorage);
// HSTS forces HTTPS; nosniff/Referrer-Policy/Permissions-Policy are low-risk
// hardening. CSP is intentionally report-friendly rather than strict for launch —
// Razorpay checkout, Leaflet tiles and the R2 asset host all need to load — so it
// allowlists the known external origins instead of locking to 'self' only.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  // Razorpay checkout injects an inline bootstrap + its own iframe.
  "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://*.r2.dev https://*.tile.openstreetmap.org https://nominatim.openstreetmap.org",
  "worker-src 'self' blob:",
].join('; ');

const SECURITY_HEADERS = [
  // Report-Only until checkout + maps are confirmed unbroken against it, then
  // switch the key to 'Content-Security-Policy' to enforce. The header below is
  // live and cannot break rendering; the other five are always safe.
  { key: 'Content-Security-Policy-Report-Only', value: CSP },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'flic.kr',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'www.pexels.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'news.microsoft.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'api.qrserver.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'pub-7a9bd7006a434f6c84ea68e69b323918.r2.dev',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
