// Who runs Retrivr, for the terms (/terms) and the privacy policy (/privacy).
// The required fields must be filled before those pages are linked from
// sign-up: until then both pages say they are a draft, and sign-up stays
// closed when TERMS_URL or PRIVACY_URL point at them (lib/signup-config.ts).
//
// Basanite is not incorporated yet, so the party to the contract is the
// person who runs it, trading as Basanite. When it becomes a company, set
// legalName to the company, add its number, and change LEGAL_VERSION.
//
// LEGAL_VERSION is the date of the text. Change it whenever the wording
// changes, and set TERMS_VERSION on the server to the same value, so each
// account records which version it agreed to.
export const LEGAL_VERSION = "2026-10-22";

export type Operator = {
  legalName: string | null;        // who the contract is with: the person's full name, or the company once registered
  tradingName: string;
  companyNumber: string | null;    // Companies House number; null while unregistered
  address: string | null;          // a postal address for notices
  contactEmail: string | null;     // for privacy requests and legal notices
  icoNumber: string | null;        // ICO data protection fee registration, once paid
  hostingLocation: string;         // where Render runs the service and database
  jurisdiction: string;            // whose law governs the terms, and whose courts decide disputes
};

export const OPERATOR: Operator = {
  legalName: "Aditya Umang Shah",
  tradingName: "Basanite",
  companyNumber: null,
  address: "100 Stoneypath, Londonderry, BT47 2AF, United Kingdom",
  contactEmail: "aditya.shah@basanite.co.uk",
  icoNumber: null,
  hostingLocation: "the European Union (Frankfurt, Germany)",
  // Where the business is run from.
  jurisdiction: "Northern Ireland",
};

// The fields without which the pages cannot be in force.
export function legalDetailsComplete(operator: Operator = OPERATOR): boolean {
  return [operator.legalName, operator.address, operator.contactEmail].every((value) => typeof value === "string" && value.trim().length > 0);
}

// What the pages print for a field not filled in yet.
export function detail(value: string | null, label: string): string {
  return value?.trim() || `[${label}]`;
}

// "Jane Doe, trading as Basanite", or the company and its number once registered.
export function operatorName(operator: Operator = OPERATOR): string {
  const name = detail(operator.legalName, "full name of the person who runs Basanite");
  return operator.companyNumber ? `${name} (company number ${operator.companyNumber})` : `${name}, trading as ${operator.tradingName}`;
}
