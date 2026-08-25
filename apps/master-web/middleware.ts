import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SECURITY_HEADERS } from "@/lib/security";

export default withAuth(
  function middleware(req: NextRequest) {
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      res.headers.set(k, v);
    }
    return res;
  },
  {
    pages: { signIn: "/login" },
    cookies: {
      sessionToken: {
        name: "__Secure-master.session",
      },
    },
    callbacks: {
      authorized: ({ token, req }) => {
        const path = req.nextUrl.pathname;
        if (path.startsWith("/api/metrics")) return !!token;
        if (path.startsWith("/api/notifications")) return !!token;
        if (path.startsWith("/api/clients")) return !!token;
        if (path.startsWith("/api/support")) return !!token;
        if (path.startsWith("/api/security")) return !!token;
        if (path.startsWith("/api/apps")) return !!token;
        if (path.startsWith("/api/maintenance")) return !!token;
        if (path.startsWith("/api/office/ingest")) return true;
        if (path.startsWith("/api/office/commands")) return true;
        if (path.startsWith("/api/office/events")) return true;
        if (path.startsWith("/api/office")) return !!token;
        if (path.startsWith("/login")) return true;
        return !!token;
      },
    },
  },
);

export const config = {
  matcher: [
    "/",
    "/vps/:path*",
    "/apps/:path*",
    "/n8n/:path*",
    "/notifications/:path*",
    "/clients/:path*",
    "/sav/:path*",
    "/securite/:path*",
    "/agents/:path*",
    "/api/office/:path*",
    "/api/metrics/:path*",
    "/api/notifications/:path*",
    "/api/clients/:path*",
    "/api/support/:path*",
    "/api/security/:path*",
    "/api/apps/:path*",
    "/api/maintenance/:path*",
    // /api/jobs, /api/workers — token auth only (excluded from session middleware)
  ],
};
