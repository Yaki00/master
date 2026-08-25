import { createHash, timingSafeEqual } from "crypto";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { getClientIp } from "./security";
import { logSecurityEvent } from "./security-log";
import { checkRateLimit, LOGIN_LIMIT, resetRateLimit } from "./rate-limit";

function safeCompare(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Master",
      credentials: {
        password: { label: "Mot de passe", type: "password" },
        honeypot: { label: "honeypot", type: "text" },
      },
      async authorize(credentials) {
        const ip = await getClientIp();

        if (credentials?.honeypot) {
          await logSecurityEvent({
            kind: "login_honeypot",
            title: "Honeypot déclenché",
            detail: "Tentative de connexion avec le champ honeypot rempli (bot probable).",
            ip,
            meta: { ip },
          });
          return null;
        }

        const limit = checkRateLimit(`login:${ip}`, LOGIN_LIMIT);
        if (!limit.ok) {
          await logSecurityEvent({
            kind: "login_rate_limited",
            title: "Connexion bloquée (rate-limit)",
            detail: `Trop de tentatives depuis ${ip}. Réessai dans ${limit.retryAfterSec}s.`,
            ip,
            meta: { retryAfterSec: limit.retryAfterSec },
          });
          throw new Error(`RATE_LIMIT:${limit.retryAfterSec}`);
        }

        const expected = process.env.MASTER_AUTH_PASSWORD;
        if (!expected || !credentials?.password) {
          await delay(800 + Math.random() * 400);
          await logSecurityEvent({
            kind: "login_failure",
            title: "Échec de connexion",
            detail: !expected
              ? "Mot de passe serveur non configuré."
              : "Mot de passe manquant.",
            ip,
          });
          return null;
        }

        if (!safeCompare(credentials.password, expected)) {
          await delay(800 + Math.random() * 400);
          await logSecurityEvent({
            kind: "login_failure",
            title: "Échec de connexion",
            detail: `Mot de passe incorrect depuis ${ip}.`,
            ip,
          });
          return null;
        }

        resetRateLimit(`login:${ip}`);
        await logSecurityEvent({
          kind: "login_success",
          title: "Connexion réussie",
          detail: `Session ouverte depuis ${ip}.`,
          ip,
        });
        return {
          id: "owner",
          name: "Admin",
          email: process.env.MASTER_AUTH_EMAIL ?? "admin@pixelbrain.fr",
        };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 8, updateAge: 60 * 60 },
  pages: { signIn: "/login" },
  secret: process.env.NEXTAUTH_SECRET,
  cookies: {
    sessionToken: {
      name: "__Secure-master.session",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: true,
      },
    },
  },
  events: {
    async signOut() {
      await logSecurityEvent({
        kind: "logout",
        title: "Déconnexion",
        detail: "Session fermée.",
      });
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.role = "owner";
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as { role?: string }).role = token.role as string;
      return session;
    },
  },
};
