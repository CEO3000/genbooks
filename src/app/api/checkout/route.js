import Stripe from "stripe";
import { adminDb } from "../../../lib/firebaseAdmin";
import { estimatePrice } from "../../../lib/pricing";

export async function POST(request) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "Payments are not connected yet." }, { status: 503 });
  }

  const { requestId } = await request.json();
  if (!requestId) {
    return Response.json({ error: "requestId is required" }, { status: 400 });
  }

  const snap = await adminDb().doc(`requests/${requestId}`).get();
  if (!snap.exists) {
    return Response.json({ error: "Request not found" }, { status: 404 });
  }
  const bookRequest = snap.data();
  if (bookRequest.paid) {
    return Response.json({ error: "Already paid" }, { status: 400 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const priceGbp = estimatePrice(bookRequest.wordCountTarget);
  const origin = request.headers.get("origin") || "https://genbooks.uk";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "gbp",
          unit_amount: Math.round(priceGbp * 100),
          product_data: { name: `Generate: ${bookRequest.title || "your book"}` },
        },
        quantity: 1,
      },
    ],
    metadata: { requestId },
    success_url: `${origin}/books/${requestId}?paid=1`,
    cancel_url: `${origin}/books/${requestId}`,
  });

  return Response.json({ url: session.url });
}
