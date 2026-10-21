import { betterAuthConfigured, googleSignInConfigured, microsoftSignInConfigured } from "@/lib/better-auth";
import { appOrigin } from "@/lib/auth";
import { LEGAL_VERSION, legalDetailsComplete } from "@/lib/legal";
import { mailConfigured } from "@/lib/mailer";

// Sign-up opens only when everything it promises exists: Better Auth's secret,
// the terms and privacy policy a new account agrees to, and at least one way
// to prove an address (email codes, Google or Microsoft). Until then /signup
// says so and the homepage keeps the contact box, so this code can ship before
// the accounts, keys and legal pages behind it are ready.
export type SignupConfig = {
  open: boolean;
  email: boolean;
  google: boolean;
  microsoft: boolean;
  termsUrl: string;
  privacyUrl: string;
  termsVersion: string;
};

function httpsUrl(value: string | undefined): string {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:") ? url.toString() : "";
  } catch {
    return "";
  }
}

// Our own /terms and /privacy cannot be agreed to while they are still a draft.
function pointsAtDraft(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === appOrigin() && ["/terms", "/privacy"].includes(url.pathname) && !legalDetailsComplete();
  } catch {
    return false;
  }
}

export function signupConfig(): SignupConfig {
  const termsUrl = httpsUrl(process.env.TERMS_URL);
  const privacyUrl = httpsUrl(process.env.PRIVACY_URL);
  const ready = betterAuthConfigured() && Boolean(termsUrl && privacyUrl) && !pointsAtDraft(termsUrl) && !pointsAtDraft(privacyUrl);
  const email = ready && mailConfigured();
  const google = ready && googleSignInConfigured();
  const microsoft = ready && microsoftSignInConfigured();
  return { open: email || google || microsoft, email, google, microsoft, termsUrl, privacyUrl, termsVersion: process.env.TERMS_VERSION?.trim() || LEGAL_VERSION };
}
