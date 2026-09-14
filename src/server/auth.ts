import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "./db";

// Email Magic Link only, per spec section 3 ("Auth.js v5 - فقط Email Magic Link").
// No OAuth providers, no passwords, no Passkey (explicitly out-of-MVP, section 14).
export const authConfig: NextAuthConfig = {
  adapter: DrizzleAdapter(db),
  providers: [
    Nodemailer({
      server: {
        host: process.env.EMAIL_SERVER_HOST,
        port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
        auth: {
          user: process.env.EMAIL_SERVER_USER,
          pass: process.env.EMAIL_SERVER_PASSWORD,
        },
      },
      from: process.env.EMAIL_FROM,
    }),
  ],
  session: { strategy: "database" },
  cookies: {
    sessionToken: {
      name: "studio.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      },
    },
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/login/check-email",
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
