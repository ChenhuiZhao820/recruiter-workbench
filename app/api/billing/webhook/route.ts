import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stripe, syncSubscription } from "@/lib/billing";
import { customerId } from "@/lib/billing-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Stripe's only way in. The signature is checked over the raw body with
// STRIPE_WEBHOOK_SECRET before anything is read; an event already applied is
// acknowledged and skipped; and what an event says is never applied as is -
// the subscription is read back from Stripe (lib/billing.ts).
const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
  "customer.subscription.paused", "customer.subscription.resumed",
]);

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !process.env.STRIPE_SECRET_KEY || !signature) return NextResponse.json({ error: "Not found." }, { status: 404 });
  let event;
  try {
    event = await stripe().webhooks.constructEventAsync(await request.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "Bad signature." }, { status: 400 });
  }
  try {
    await db.stripeEvent.create({ data: { id: event.id, type: event.type } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ received: true, duplicate: true });
    throw error;
  }
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const subscription = customerId(session.subscription);
      if (session.mode === "subscription" && subscription) await syncSubscription(subscription, session.client_reference_id);
    } else if (SUBSCRIPTION_EVENTS.has(event.type)) {
      await syncSubscription((event.data.object as { id: string }).id);
    } else if (event.type === "invoice.payment_failed" || event.type === "invoice.paid") {
      const invoice = event.data.object as { parent?: { subscription_details?: { subscription?: unknown } | null } | null };
      const subscription = customerId(invoice.parent?.subscription_details?.subscription);
      if (subscription) await syncSubscription(subscription);
    }
  } catch {
    // Not applied: forget the event so Stripe's retry gets another go.
    await db.stripeEvent.deleteMany({ where: { id: event.id } });
    return NextResponse.json({ error: "Could not apply the event." }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
