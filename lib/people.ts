import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "./db";
import { buildSearchText, canonicalProfileUrl, cleanMemberId, suppressionHashes } from "./person-keys.mjs";

// One person across every role they are considered for. A person is matched
// by LinkedIn's member id first, then by their canonical profile link, and is
// never matched by name: two people can share a name, and a wrong merge is
// far worse than a duplicate the recruiter can see.

type Client = PrismaClient | Prisma.TransactionClient;

export type PersonIdentity = {
  fullName: string;
  profileUrl?: string | null;
  memberId?: string | null;
  headline?: string | null;
};

export function personSearchText(person: {
  fullName: string;
  headline?: string | null;
  location?: string | null;
  skillsSummary?: string | null;
  motivation?: string | null;
}): string {
  return buildSearchText([person.fullName, person.headline, person.location, person.skillsSummary, person.motivation]);
}

async function findExisting(client: Client, ownerId: string, memberId: string | null, profileUrl: string | null) {
  if (memberId) {
    const byMember = await client.person.findUnique({ where: { userId_memberId: { userId: ownerId, memberId } } });
    if (byMember) return byMember;
  }
  if (profileUrl) {
    return client.person.findUnique({ where: { userId_profileUrl: { userId: ownerId, profileUrl } } });
  }
  return null;
}

export async function findOrCreatePerson(client: Client, ownerId: string, identity: PersonIdentity) {
  const memberId = cleanMemberId(identity.memberId);
  const profileUrl = canonicalProfileUrl(identity.profileUrl);
  const fullName = identity.fullName.trim();
  const headline = identity.headline?.trim() || null;

  // Without either identifier there is nothing to recognise the person by
  // later, so they get a record of their own.
  if (memberId || profileUrl) {
    const existing = await findExisting(client, ownerId, memberId, profileUrl);
    if (existing) {
      const fill: Prisma.PersonUpdateInput = {};
      if (!existing.headline && headline) fill.headline = headline;
      if (!existing.profileUrl && profileUrl) {
        const taken = await client.person.findUnique({ where: { userId_profileUrl: { userId: ownerId, profileUrl } } });
        if (!taken) fill.profileUrl = profileUrl;
      }
      if (!existing.memberId && memberId) {
        const taken = await client.person.findUnique({ where: { userId_memberId: { userId: ownerId, memberId } } });
        if (!taken) fill.memberId = memberId;
      }
      if (Object.keys(fill).length === 0) return existing;
      return client.person.update({
        where: { id: existing.id },
        data: { ...fill, searchText: personSearchText({ ...existing, headline: existing.headline || headline }) },
      });
    }
  }

  try {
    return await client.person.create({
      data: {
        user: { connect: { id: ownerId } },
        fullName,
        profileUrl,
        memberId,
        headline,
        searchText: personSearchText({ fullName, headline }),
      },
    });
  } catch (error) {
    // Two saves of the same profile at once: the unique index refused the
    // second insert, so the first one's record is the person.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await findExisting(client, ownerId, memberId, profileUrl);
      if (existing) return existing;
    }
    throw error;
  }
}

// Candidates written before people existed have no person yet. Linking them
// is lazy: whichever screen first needs the person creates the link.
export async function ensureCandidatePerson(candidateId: string, ownerId: string): Promise<string | null> {
  const candidate = await db.candidate.findFirst({
    where: { id: candidateId, role: { userId: ownerId } },
    select: { id: true, personId: true, fullName: true, profileUrl: true, memberId: true, headline: true },
  });
  if (!candidate) return null;
  if (candidate.personId) return candidate.personId;
  const person = await findOrCreatePerson(db, ownerId, candidate);
  await db.candidate.update({ where: { id: candidate.id }, data: { personId: person.id } });
  return person.id;
}

export async function isSuppressed(
  client: Client,
  ownerId: string,
  identity: { profileUrl?: string | null; memberId?: string | null; email?: string | null }
): Promise<boolean> {
  const hashes = suppressionHashes(identity);
  if (hashes.length === 0) return false;
  const hit = await client.suppression.findFirst({ where: { userId: ownerId, keyHash: { in: hashes } }, select: { keyHash: true } });
  return Boolean(hit);
}
