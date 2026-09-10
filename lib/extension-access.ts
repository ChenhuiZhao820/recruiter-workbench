import { hashToken, newSecret } from "@/lib/auth-crypto";

export function canUseExtension(user: { role: string; active: boolean; extensionAccess?: { activatedAt: Date | null } | null }): boolean {
  return user.active && (user.role === "admin" || Boolean(user.extensionAccess?.activatedAt));
}

export function newExtensionCode(): string {
  return newSecret();
}

export function hashExtensionCode(code: string): string {
  return hashToken(code);
}
