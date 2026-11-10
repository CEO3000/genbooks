import Stripe from "stripe";
import { adminDb } from "../../../lib/firebaseAdmin";

// Payment only unlocks the book. Writing starts when the customer presses
// "Continue generating all pages" (/api/continue), a deliberate decision by
// the site owner, reconfirmed 2026-10-15. Nothing here starts a job.

export async function POST(request) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: "Payments are not connected yet." }, { status: 503 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return Response.json({ error: `Webhook signature verification failed: ${err.message}` }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const requestId = session.metadata?.requestId;
    if (requestId) {
      const db = adminDb();
      await db.doc(`requests/${requestId}`).update({
        paid: true,
        paidAt: new Date().toISOString(),
        status: "paid",
        // Where the "your book is ready" email goes (deliveryEmail.js).
        ...(session.customer_details?.email ? { customerEmail: session.customer_details.email } : {}),
      });
    }
  }

  return Response.json({ received: true });
}
