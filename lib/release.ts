import { db } from "@/lib/db";
import { RELEASES as RELEASE_LIST, releaseDay } from "@/lib/releases.mjs";

// What is worth stopping someone for, once.
//
// There is one current release, not an archive. A release is news exactly once
// per account: `Settings.seenRelease` holds the id of the last one an account
// was shown, so bumping the id below is the whole of "tell everyone again".
//
// It is deliberately coarse. Anything that does not change how the work is done
// does not belong here, because a notice that cries wolf gets dismissed
// unread - and this is the only channel that reaches a recruiter who does not
// read the repository.
//
// Each release is also a line on Notifications, newest first. Only the first
// one has a /whats-new page; earlier ones keep the one sentence that said what
// they changed. `extension` is the extension version that release needs, or
// null, because Chrome never updates one loaded by hand. The list itself is in
// lib/releases.mjs, where a test holds it against the extension's manifest.

export type Release = { id: string; title: string; extension: string | null; fingerprint?: string };

export const RELEASES: readonly Release[] = RELEASE_LIST;

export const CURRENT_RELEASE = RELEASES[0].id;
export const currentRelease = RELEASES[0];

// A brand new account has used no earlier version, so what changed since one
// is not news to them; they get the setup guide instead. Everyone else is
// shown a release until they say they have read it.
export async function hasSeenCurrentRelease(userId: string): Promise<boolean> {
  const settings = await db.settings.findUnique({
    where: { userId },
    select: { seenRelease: true },
  });
  return settings?.seenRelease === CURRENT_RELEASE;
}

export async function markCurrentReleaseSeen(userId: string): Promise<void> {
  await db.settings.upsert({
    where: { userId },
    update: { seenRelease: CURRENT_RELEASE },
    create: { userId, seenRelease: CURRENT_RELEASE },
  });
}

export type ReleaseNotice = { release: Release; at: Date; current: boolean; unread: boolean };

// Releases as notifications, for one account: those shipped since it was
// created, so an account opened last week is not told about last month's
// changes. Unread is only ever the current one, until Got it is pressed.
export async function releaseNotices(userId: string, currentIsNews: boolean): Promise<ReleaseNotice[]> {
  const account = await db.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  const since = account ? account.createdAt.toISOString().slice(0, 10) : releaseDay(CURRENT_RELEASE);
  return RELEASES
    .filter((release) => releaseDay(release.id) >= since)
    .map((release) => ({
      release,
      at: new Date(`${releaseDay(release.id)}T00:00:00Z`),
      current: release.id === CURRENT_RELEASE,
      unread: release.id === CURRENT_RELEASE && currentIsNews,
    }));
}
