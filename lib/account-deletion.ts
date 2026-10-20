import type { Prisma } from "@prisma/client";

// Removes an account and everything in it, inside the caller's transaction.
// Most business tables point at the user with onDelete Restrict, so the data
// goes explicitly, children before parents; the rest cascades with the user.
// Audit events have no foreign key and stay. TrialClaim and Suppression rows
// are not the account's data: a trial is still used, and an erased person
// stays erased.
export async function deleteAccountData(tx: Prisma.TransactionClient, userId: string) {
  await tx.session.updateMany({ where: { viewUserId: userId }, data: { viewUserId: null } });
  await tx.booking.deleteMany({ where: { userId } });
  await tx.savedSearch.deleteMany({ where: { userId } });
  await tx.role.deleteMany({ where: { userId } });
  await tx.person.deleteMany({ where: { userId } });
  await tx.messageTemplate.deleteMany({ where: { userId } });
  await tx.settings.deleteMany({ where: { userId } });
  await tx.user.delete({ where: { id: userId } });
}
