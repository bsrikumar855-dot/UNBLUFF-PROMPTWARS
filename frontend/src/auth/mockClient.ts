import { AuthError, type AuthClient, type AuthUser } from "./types";

/**
 * DEMO ONLY (VITE_AUTH_MODE=mock; ignored in production builds). A stand-in identity provider so the prototype
 * runs with no Firebase project. It starts signed in as a demo student; any email and password signs in as that
 * email. Its "ID token" is `mock:<uid>`, which the backend accepts only when it runs with AUTH_MODE=mock.
 */
const KEY = "unbluff.mockAuth";

function uidFor(email: string): string {
  const slug = email.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return `demo-${slug || "student"}`;
}

function load(): AuthUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "out") return null;
    if (raw) return JSON.parse(raw) as AuthUser;
  } catch {
    /* storage unavailable: fall through to the default demo user */
  }
  return { uid: "demo-student", email: "demo@unbluff.dev", emailVerified: true };
}

function save(v: AuthUser | null): void {
  try {
    localStorage.setItem(KEY, v ? JSON.stringify(v) : "out");
  } catch {
    /* ignore */
  }
}

const listeners = new Set<(u: AuthUser | null) => void>();
let current: AuthUser | null = load();

function set(u: AuthUser | null): void {
  current = u;
  save(u);
  listeners.forEach((l) => l(u));
}

function signInAs(email: string): void {
  const e = email.trim();
  if (!e) throw new AuthError("Enter an email address.", "auth/invalid-email");
  set({ uid: uidFor(e), email: e, emailVerified: true });
}

export const mockAuthClient: AuthClient = {
  configured: true,
  onChange(cb) {
    listeners.add(cb);
    cb(current);
    return () => void listeners.delete(cb);
  },
  async signIn(email) {
    signInAs(email);
  },
  async signUp(email) {
    signInAs(email);
  },
  async signOut() {
    set(null);
  },
  async sendPasswordReset() {
    /* nothing to send in demo mode */
  },
  async getIdToken() {
    return current ? `mock:${current.uid}` : null;
  },
  async sendVerificationEmail() {
    /* always verified */
  },
  async refreshUser() {
    /* nothing to refresh */
  },
  async changePassword() {
    /* demo accounts have no password */
  },
  async verifyPassword() {
    /* demo accounts have no password */
  },
  async deleteAccount() {
    set(null);
  },
};

/** True only for a dev/demo build that asked for it; never in a production build, and never under test (so a local .env can't change test results). */
export const MOCK_AUTH_ENABLED = import.meta.env.VITE_AUTH_MODE === "mock" && !import.meta.env.PROD && import.meta.env.MODE !== "test";
