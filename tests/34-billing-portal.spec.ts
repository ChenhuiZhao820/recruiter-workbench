import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "./helpers";
import { hashToken } from "../lib/auth-crypto";
import { CURRENT_RELEASE } from "../lib/release";
import { formatDay } from "../lib/billing-core.mjs";

// The billing portal: Billing in the sidebar, the plan and this month's
// credits, invoices and billing details read from Stripe on each visit,
// and every change of plan, card or cancellation handed to Stripe's own
// portal. Stripe is the local stub; fictional accounts and the disposable
// database only.

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const STUB = "http://localhost:8766";

type Account = { user: { id: string }; page: Page; close: () => Promise<void> };

async function account(browser: Browser, data: Record<string, unknown>, session: { viewUserId?: string } = {}): Promise<Account> {
  const user = await db.user.create({ data: {
    email: `billing-${randomUUID()}@test.capture.invalid`, name: "Ines Varga", role: "recruiter",
    settings: { create: { seenRelease: CURRENT_RELEASE, recruiterName: "Ines Varga" } },
    ...data,
  } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { tokenHash: hashToken(token), userId: user.id, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 3_600_000), ...session } });
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  await context.addCookies([{ name: "capture_session", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  return { user, page: await context.newPage(), close: () => context.close() };
}

async function stripeState(set: Record<string, unknown> = {}) {
  const response = await fetch(`${STUB}/__stripe`, { method: "POST", body: JSON.stringify(set) });
  return response.json() as Promise<{ lastPortal: Record<string, string> | null }>;
}

const ids = () => randomUUID().replace(/-/g, "").slice(0, 14);

function invoice(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, object: "invoice", number: `RTV-${id.slice(-4).toUpperCase()}`, status: "paid", currency: "gbp", amount_paid: 2999, amount_due: 0, total: 2999,
    created: Math.floor(Date.UTC(2026, 9, 21) / 1000), status_transitions: { finalized_at: Math.floor(Date.UTC(2026, 9, 21) / 1000) },
    hosted_invoice_url: `http://localhost:8766/stripe-invoice/${id}`, invoice_pdf: `http://localhost:8766/stripe-invoice/${id}.pdf`,
    lines: { object: "list", data: [{ description: "1 × Retrivr Basic (at £29.99 / month)" }] }, ...extra,
  };
}

test("BP1 Billing is in the sidebar; a plan set up by Retrivr shows what it includes and this month's credits", async ({ browser }) => {
  const pro = await account(browser, { accountTier: "pro" });
  const now = new Date();
  await db.aiUsage.create({ data: { userId: pro.user.id, month: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`, generations: 3 } });
  const { page } = pro;
  await page.goto("/");
  const link = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Billing" });
  await expect(link).toHaveAttribute("href", "/billing");
  await link.click();
  await expect(page).toHaveURL(`${BASE}/billing`);
  await expect(link).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("tab")).toHaveText(["Overview", "Invoices", "Plans"]);

  const plan = page.getByRole("region", { name: "Current plan" });
  await expect(plan.getByRole("heading", { name: "Pro plan" })).toBeVisible();
  await expect(plan.getByText("Set up by Retrivr", { exact: true })).toBeVisible();
  const included = plan.getByRole("list", { name: "Included in your plan" });
  await expect(included.getByText("Email finder")).toBeVisible();
  await expect(included.getByText("Chrome extension")).toBeVisible();
  await expect(plan.getByText("Unlock more features")).toHaveCount(0);

  const usage = page.getByRole("region", { name: "This month’s credits" });
  await expect(usage.getByText("3 of 120")).toBeVisible();
  await expect(usage.getByText("Email finder searches")).toBeVisible();
  // No subscription: nothing to manage on Stripe yet.
  await expect(page.getByRole("heading", { name: "Manage subscription" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Invoices" }).click();
  await expect(page).toHaveURL(`${BASE}/billing?tab=invoices`);
  await expect(page.getByRole("heading", { name: "No invoices yet" })).toBeVisible();

  // Plans & prices opens the Plans tab.
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByRole("link", { name: /Plans & prices/ }).click();
  await expect(page.getByRole("heading", { name: "Choose a plan" })).toBeVisible();
  await expect(page.locator("article").filter({ has: page.getByRole("heading", { name: "Pro", exact: true }) }).getByRole("button", { name: "Choose Pro" })).toBeVisible();
  await pro.close();
});

test("BP2 a paying account reads its invoices and billing details from Stripe and goes to the portal to change anything", async ({ browser }) => {
  const customer = `cus_${ids()}`;
  const sub = `sub_${ids()}`;
  const periodEnd = new Date(Date.now() + 20 * 86_400_000);
  const paying = await account(browser, {
    signupSource: "self", accountTier: "none", stripeCustomerId: customer, stripeSubscriptionId: sub,
    billingPlan: "basic", billingInterval: "monthly", billingStatus: "active", billingPeriodEnd: periodEnd,
  });
  await stripeState({
    customers: { [customer]: { name: "Aditya Shah", email: "aditya@test-billing.example", address: { postal_code: "BT47 2AF", country: "GB" }, tax_ids: { object: "list", data: [] } } },
    invoices: { [customer]: [
      invoice("in_paid0001"),
      invoice("in_draft0002", { status: "draft", number: null }),
      invoice("in_open0003", { status: "open", amount_due: 4999, invoice_pdf: "https://files.evil.example/x.pdf" }),
    ] },
  });
  const { page } = paying;
  await page.goto("/billing");
  await expect(page.getByText("Basic, billed monthly through Stripe.")).toBeVisible();
  await expect(page.getByText(`renew automatically on ${formatDay(periodEnd)}`)).toBeVisible();
  await expect(page.getByRole("region", { name: "Current plan" }).getByText("Active", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Invoices" }).click();
  const details = page.getByRole("region", { name: "Billing details" });
  await expect(details.getByText("Aditya Shah")).toBeVisible();
  await expect(details.getByText("United Kingdom")).toBeVisible();
  await expect(details.getByText("Incomplete address: add the street and the city.")).toBeVisible();
  await expect(details.getByRole("button", { name: "Complete" })).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(3);
  const paid = table.getByRole("row").filter({ hasText: "RTV-0001" });
  await expect(paid).toContainText("1 × Retrivr Basic");
  await expect(paid).toContainText("£29.99");
  await expect(paid).toContainText("Paid");
  await expect(paid.getByRole("link", { name: /Download invoice/ })).toHaveAttribute("href", "http://localhost:8766/stripe-invoice/in_paid0001.pdf");
  const open = table.getByRole("row").filter({ hasText: "RTV-0003" });
  await expect(open).toContainText("£49.99");
  await expect(open).toContainText("Due");
  // A PDF link that is not Stripe's is not offered.
  await expect(open.getByRole("link", { name: /Download invoice/ })).toHaveCount(0);
  await expect(open.getByRole("link", { name: /View invoice/ })).toHaveCount(1);

  // Each change is Stripe's own flow, for this subscription.
  for (const [button, flow] of [["Change plan", "subscription_update"], ["Update card", "payment_method_update"], ["Cancel subscription", "subscription_cancel"]] as const) {
    await page.goto("/billing");
    await page.getByRole("region", { name: "Manage subscription" }).getByRole("button", { name: button }).click();
    await expect(page).toHaveURL(`${STUB}/stripe-portal/${flow}`);
    const { lastPortal } = await stripeState();
    expect(lastPortal).toMatchObject({ customer, "flow_data[type]": flow, return_url: `${BASE}/billing` });
    if (flow !== "payment_method_update") expect(lastPortal![`flow_data[${flow}][subscription]`]).toBe(sub);
  }

  // A flow the page does not offer opens the portal's home page instead.
  await page.goto("/billing");
  const cancel = page.getByRole("region", { name: "Manage subscription" }).locator('input[name="flow"][value="cancel"]');
  await cancel.evaluate((input: HTMLInputElement) => { input.value = "customer_update"; });
  await page.getByRole("button", { name: "Cancel subscription" }).click();
  await expect(page).toHaveURL(`${STUB}/stripe-portal`);
  expect((await stripeState()).lastPortal!["flow_data[type]"]).toBeUndefined();

  // Picking another plan while paying is a change on Stripe, never a second subscription.
  await page.goto("/billing?tab=plans");
  await expect(page.getByRole("heading", { name: "Change plan" })).toBeVisible();
  const basic = page.locator("article").filter({ has: page.getByRole("heading", { name: "Basic", exact: true }) });
  await expect(basic.getByText("Current plan")).toBeVisible();
  await expect(basic.getByRole("button", { name: "Your plan" })).toBeDisabled();
  await page.locator("article").filter({ has: page.getByRole("heading", { name: "Pro", exact: true }) }).getByRole("button", { name: "Switch to Pro" }).click();
  await expect(page).toHaveURL(`${STUB}/stripe-portal/subscription_update`);
  await paying.close();
});

test("BP3 Stripe being down leaves the page standing; a cancelled plan offers to keep it", async ({ browser }) => {
  const customer = `cus_${ids()}`;
  const periodEnd = new Date(Date.now() + 5 * 86_400_000);
  const ending = await account(browser, {
    stripeCustomerId: customer, stripeSubscriptionId: `sub_${ids()}`, billingPlan: "pro", billingInterval: "yearly", billingStatus: "active",
    billingPeriodEnd: periodEnd, billingCancelAtPeriodEnd: true,
  });
  await stripeState({ customers: { [customer]: "fail" } });
  const { page } = ending;
  await page.goto("/billing");
  await expect(page.getByText(`Your plan will end on ${formatDay(periodEnd)}.`)).toBeVisible();
  await expect(page.getByRole("region", { name: "Current plan" }).getByText("Ending", { exact: true })).toBeVisible();
  const manage = page.getByRole("region", { name: "Manage subscription" });
  await expect(manage.getByRole("button", { name: "Cancel subscription" })).toHaveCount(0);
  await expect(manage.getByRole("button", { name: "Keep my plan" })).toBeVisible();
  await page.getByRole("tab", { name: "Invoices" }).click();
  await expect(page.getByText("Stripe could not be reached just now.", { exact: false })).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Stripe portal/ })).toBeVisible();
  await ending.close();
});

test("BP4 an administrator's read-only view never shows another account's billing", async ({ browser }) => {
  const customer = `cus_${ids()}`;
  const owner = await db.user.create({ data: { email: `billing-owner-${randomUUID()}@test.capture.invalid`, name: "Owner", role: "recruiter", accountTier: "basic", stripeCustomerId: customer, settings: { create: {} } } });
  await stripeState({ customers: { [customer]: { name: "Owner Secret Ltd", address: {} } } });
  const admin = await account(browser, { role: "admin", name: "Admin Viewer" }, { viewUserId: owner.id });
  await admin.page.goto("/billing");
  await expect(admin.page.getByText("Billing belongs to each account.")).toBeVisible();
  await expect(admin.page.getByText("Owner Secret Ltd")).toHaveCount(0);
  await expect(admin.page.getByRole("tab")).toHaveCount(0);
  await admin.close();
});

test("BP5 at phone width the invoices fit without a sideways scroll", async ({ browser }) => {
  const customer = `cus_${ids()}`;
  const phone = await account(browser, { stripeCustomerId: customer, stripeSubscriptionId: `sub_${ids()}`, billingPlan: "lite", billingInterval: "monthly", billingStatus: "active", billingPeriodEnd: new Date(Date.now() + 86_400_000) });
  await stripeState({
    customers: { [customer]: { name: "Ines Varga", address: { line1: "4 Quay Road", city: "Derry", postal_code: "BT48 7AA", country: "GB" } } },
    invoices: { [customer]: [invoice("in_phone0001"), invoice("in_phone0002")] },
  });
  await phone.page.setViewportSize({ width: 375, height: 812 });
  for (const tab of ["", "?tab=invoices", "?tab=plans"]) {
    await phone.page.goto(`/billing${tab}`);
    await expect(phone.page.getByRole("tabpanel")).toBeVisible();
    expect(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await expect(phone.page.getByText("Incomplete address")).toHaveCount(0);
  await phone.close();
});
