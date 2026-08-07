// Edge middleware — uses only the lightweight auth config (no Prisma/bcrypt/nodemailer).
// Route protection logic lives in authConfig.callbacks.authorized.

import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';
import { NextRequest, NextResponse } from 'next/server';

const { auth } = NextAuth(authConfig);

export default auth(function middleware(req: NextRequest) {
  // Strip legacy Clerk handshake params during transition
  if (req.nextUrl.searchParams.has('__clerk_handshake')) {
    const url = req.nextUrl.clone();
    url.searchParams.delete('__clerk_handshake');
    url.searchParams.delete('__clerk_help_debug_token');
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

// Only run middleware on the routes that actually need it.
// Keeping the matcher tight reduces edge invocations and bundle pressure.
export const config = {
  matcher: [
    '/dashboard/:path*',
    // Clerk cleanup — remove once all traffic has migrated
    '/(.*)?__clerk_handshake(.*)',
  ],
};
