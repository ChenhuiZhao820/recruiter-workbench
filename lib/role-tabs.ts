// The three parts of a role page, in tab order. Plain data, so the server page
// can read `?tab=` with it and the client tabs can lay themselves out by it.
export const ROLE_TABS = ["briefing", "candidates", "searches"] as const;
export type RoleTab = (typeof ROLE_TABS)[number];

export function roleTabFrom(value: string | undefined): RoleTab {
  return (ROLE_TABS as readonly string[]).includes(value ?? "") ? (value as RoleTab) : "candidates";
}
