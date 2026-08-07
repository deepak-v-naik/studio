// Edge-safe Auth.js config — no Prisma, bcrypt, or nodemailer imports.
// Used by middleware for lightweight JWT verification.

import type { NextAuthConfig } from 'next-auth';

export const authConfig: NextAuthConfig = {
  pages:     { signIn: '/login' },
  trustHost: true,
  session:   { strategy: 'jwt' },
  providers: [], // providers are added in the full auth.ts (Node.js only)
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const loggedIn = !!auth?.user;
      const pathname = nextUrl.pathname;

      // /store-dashboard is NOT gated here: unauthenticated visitors previously got
      // redirected to `/store-dashboard` itself -- the same protected path -- which
      // re-triggered this same check and infinite-looped, so nobody could ever reach
      // the sign-in form. The page already renders its own sign-in form client-side
      // when there's no session (store partners aren't required to hold a next-auth
      // session at all -- see CLAUDE.md), so it doesn't need a middleware gate.
      if (pathname.startsWith('/dashboard')) {
        if (loggedIn) return true;
        return Response.redirect(new URL('/login', nextUrl));
      }
      return true;
    },
  },
};
