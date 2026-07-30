import type { Metadata } from 'next';
import './globals.css';
import '../bones/registry';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as SonnerToaster } from 'sonner';
import { Providers } from '@/components/providers';
import { cn } from '@/lib/utils';
import { NetworkBanner } from '@/components/errors/network-banner';
import { SessionExpiredModal } from '@/components/errors/session-expired-modal';
import { PwaRegister } from '@/components/pwa-register';
import ChunkErrorRecovery from '@/components/chunk-error-recovery';

export const metadata: Metadata = {
  title: 'ALIVE — In-store advertising for Indian kirana stores',
  description:
    'Alive connects brands, kirana stores, and consumers — right where purchase decisions happen.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ALIVE Partner',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
      <html lang="en">
        <head>
          {/* ELU Analytics */}
          <script async src="https://elu.dev/v1/elu_pk_live_K1L6QWGkeB5UyhEp3HiP6sc70C.js" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link
            href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&family=Manrope:wght@200..800&family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300;1,400&display=swap"
            rel="stylesheet"
          />
          {/* PWA / home-screen meta */}
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="default" />
          <meta name="apple-mobile-web-app-title" content="ALIVE Partner" />
          <meta name="application-name" content="ALIVE Partner" />
          <meta name="msapplication-TileColor" content="#ef4444" />
          <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
          <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
        </head>
        <body
          className={cn('min-h-screen bg-background font-sans antialiased')}
          style={{ fontFamily: '"Manrope", system-ui, sans-serif' }}
        >
          <ChunkErrorRecovery />
          <PwaRegister />
          <NetworkBanner />
          <SessionExpiredModal />
          <Providers>{children}</Providers>
          <Toaster />
          <SonnerToaster richColors position="top-right" />
        </body>
      </html>
  );
}
