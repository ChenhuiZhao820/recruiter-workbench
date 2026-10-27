import { db } from "@/lib/db";
import { canUseExtension } from "@/lib/extension-access";
import { getWorkspace } from "@/lib/workspace";
import { hasSeenCurrentRelease } from "@/lib/release";

// Setup steps a new account works through after its password is set. State is
// derived from what the account already has, so nothing here is a second copy
// of the truth and no schema column has to be kept in sync. A step whose
// completion happens on the recruiter's own computer (installing an unpacked
// extension) reports "manual": it is a real instruction the app cannot observe,
// and counting it as done would be a guess.
export type OnboardingStepId = "password" | "profile" | "role" | "extension" | "install" | "captureKey";
export type OnboardingStep = { id: OnboardingStepId; done: boolean; manual?: true };
export type OnboardingStatus = {
  steps: OnboardingStep[];
  done: number;
  total: number;
  complete: boolean;
  untouched: boolean;
  extensionEnabled: boolean;
  isAdmin: boolean;
  recruiterName: string;
  hasCalendarLink: boolean;
  openRoleId: string | null;
};

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const { owner } = await getWorkspace();
  return statusFor(owner.id, owner.role);
}

// Used at sign-in, where the session cookie has only just been written and the
// account is identified directly rather than through the request.
export async function isNewAccount(userId: string, role: string): Promise<boolean> {
  return (await statusFor(userId, role)).untouched;
}

// The current release is news to an account that has not read it and used an
// earlier version. Same rule as sign-in and the top bar link; the bell counts it.
export async function releaseIsNews(user: { id: string; role: string }): Promise<boolean> {
  if (await hasSeenCurrentRelease(user.id)) return false;
  return !(await isNewAccount(user.id, user.role));
}

async function statusFor(userId: string, ownerRole: string): Promise<OnboardingStatus> {
  const owner = { id: userId, role: ownerRole };
  const [account, openRole] = await Promise.all([
    db.user.findUnique({
      where: { id: owner.id },
      select: {
        role: true,
        active: true,
        passwordHash: true,
        accountTier: true,
        trialExpiresAt: true,
        signupSource: true,
        billingPlan: true,
        billingStatus: true,
        billingPastDueSince: true,
        promoProFrom: true,
        promoProUntil: true,
        authAccounts: { select: { id: true }, take: 1 },
        settings: { select: { recruiterName: true, calendarLink: true, captureTokenHash: true } },
      },
    }),
    db.role.findFirst({ where: { userId: owner.id, status: "open" }, orderBy: { createdAt: "asc" }, select: { id: true } }),
  ]);
  const settings = account?.settings ?? null;
  const isAdmin = owner.role === "admin";
  const extensionEnabled = account ? canUseExtension({ ...account, ...owner }) : false;
  const captureKey = Boolean(settings?.captureTokenHash);
  const recruiterName = settings?.recruiterName?.trim() ?? "";
  const steps: OnboardingStep[] = [
    // A password, or Google or Microsoft: either is a way back in.
    { id: "password", done: Boolean(account?.passwordHash || account?.authAccounts.length) },
    { id: "profile", done: Boolean(recruiterName) },
    { id: "role", done: Boolean(openRole) },
    { id: "extension", done: extensionEnabled },
    // Loading an unpacked extension happens in Chrome, not in the workbench.
    { id: "install", done: captureKey, manual: true },
    { id: "captureKey", done: captureKey },
  ];
  const tracked = steps.filter((step) => !step.manual);
  const done = tracked.filter((step) => step.done).length;
  return {
    steps,
    done,
    total: tracked.length,
    complete: done === tracked.length,
    // A brand-new account: the sign-in and the plan came with it, so neither
    // counts as use.
    untouched: !recruiterName && !openRole && !captureKey,
    extensionEnabled,
    isAdmin,
    recruiterName,
    hasCalendarLink: Boolean(settings?.calendarLink?.trim()),
    openRoleId: openRole?.id ?? null,
  };
}
