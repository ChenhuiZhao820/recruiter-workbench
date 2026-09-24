import { db } from "@/lib/db";

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

export const CURRENT_RELEASE = "2026-09-24";

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
