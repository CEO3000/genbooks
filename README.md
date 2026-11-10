# GenBooks

A web app where an author describes a non-fiction book and gets a free preview of its opening pages. If they like it, they pay once and the full book is written, edited and delivered as an EPUB, a PDF and a cover, with no one at the keyboard in between.

**Stack:** Next.js 16 (App Router) and React 19 on Vercel, Firebase Auth and Firestore, Stripe Checkout, the Gemini API for text and the cover image, Cloudflare Turnstile, SMTP for email, `jszip` and `pdfkit` for the book files. About 6,000 lines of JavaScript and 1,100 lines of tests (98 tests).

> **About this repository.** This is a portfolio copy of a live product ([genbooks.uk](https://genbooks.uk)). Production secrets, the live Firebase project settings and the product's own writing and cover-design craft rules are not included. The rules the code reads are short, clearly labelled stand-ins. I designed the product and its rules and I operate it. It was built with an AI coding assistant (Claude Code) under my direction. The [engineering log](docs/ENGINEERING_LOG.md) records the real problems found in use and how each one was fixed.

## What it does

1. **Request.** The author fills in a book brief (title, reader, promise, tone, length) and a robot check. An account with a confirmed email is needed for the free preview.
2. **Free preview.** A background job plans the chapters, writes About the Author and the Introduction, drafts and edits the opening pages, and shows them in an on-screen reader. The author sees live progress.
3. **Payment.** Stripe Checkout, in pounds. The price is worked out on the server from the stored request: £7 up to 30,000 words, then £2 for every started 10,000.
4. **The book.** After an explicit "Continue generating" click, a second job writes every chapter, edits each one, designs the cover and builds the EPUB and PDF.
5. **Delivery.** The files are stored against the request, readable only by the paying owner (and admins), and an email says the book is ready.

## What makes it interesting engineering

- **A job system that survives a serverless platform.** Every unit of work is one function call under a *lease*, with a hard deadline shorter than the platform's limit, retries with growing waits, and a self-restarting watchdog behind it. A job cannot fork into two copies that pay the model twice, and a step killed mid-flight is picked up again. See [the architecture notes](docs/ARCHITECTURE.md).
- **Idempotent money paths.** Stripe delivers webhooks at least once, and people double-click. Starting a book is one transaction that either creates the job or returns the existing one, and a finished book is never written twice.
- **Cost designed in, and measured.** Nothing is spent before a confirmed email, a weekly per-person limit and a robot check. A full book refuses to run unless it is paid for (or started by an admin). Every call records the token counts Google reports, so the real cost of each preview and book can be read off its job.
- **Quality without a human editor.** A mechanical gate checks every chapter for the things a regex can decide (dash variants, a list of machine-voice phrases, leftover placeholders). A failure triggers one targeted repair pass and then fails the job honestly instead of shipping it.
- **Truncation is an error.** The Gemini client streams the answer and refuses anything that did not finish cleanly. A reply cut off by the token limit used to be saved as if it were complete.
- **Security enforced where it cannot be skipped.** Firestore rules forbid the browser from creating or changing requests, so the payment flag cannot be self-granted. The robot check runs inside the protected routes, not as a separate call a client can skip.
- **Honest progress.** The progress bar is driven by backend state and eased with time inside a stage so it never sits still or goes backwards. This is covered by tests.

## Tests

`npm test` runs 98 tests and needs no network, no Firebase project and no API key. The model and the payment provider are never called. Firestore is replaced by a small in-memory stand-in (`tests/helpers/fakeFirestore.mjs`), and `fetch` is replaced by scripted responses.

| Area | What is checked |
|---|---|
| Job leases and retries | one worker per job even under eight simultaneous triggers, takeover of an expired lease, the retry schedule, giving up after the budget |
| Idempotent kickoff | repeated and simultaneous starts create one job, a finished book is not redone, a preview does not block the paid book |
| Preview rules | one account per connection, browser and disguised email per week, replace-once-a-week, requests that never started a preview do not count |
| Gemini client | streaming, split events, hidden thinking, truncation refused, retries, deadline abort, key kept out of the body |
| Quality gate | each banned pattern, no false positives on look-alike words, the 20 percent word-count rule |
| Auth and captcha | token accepted only for this project and key, expired, unsigned and foreign tokens refused, captcha fails closed |
| Books | markdown to blocks, EPUB structure (mimetype first and stored), cover handling, escaping, PDF output |
| Rules and pricing | the price bands, email normalisation, disposable domains, spam detection, progress display |

I also broke the lease check, the idempotent kickoff, the truncation guard and the token audience check on purpose, and confirmed that tests fail each time.

## Honest limitations

- **The production repository had no automated tests when I made this copy.** Earlier checks were manual or one-off scripts run against the real Firestore, and the commit messages record them. The suite here was written afterwards for this copy. It tests the logic against an in-memory stand-in that runs transactions one at a time, so it does not prove how real Firestore behaves under contention.
- The API routes, the Stripe webhook and the browser pages have no automated tests, and there is no end-to-end test of a whole book.
- `npm run lint` reports three findings that I have left as they are in production: an unescaped apostrophe and two effects that set state directly.
- Only the front cover is built. The back cover and paperback wrap would need real page counts and spine widths, so that function throws on purpose instead of guessing.
- Book files are stored in Firestore as base64 chunks, because Cloud Storage needs a paid plan. That works for these file sizes but is not what I would choose with budget.
- A word count more than 20 percent off a chapter's budget is logged on the job but does not fail it.
- On Vercel's free plan a cron can run only once a day, so the watchdog also runs itself every four minutes while work exists, with a GitHub Actions schedule as a backup clock (kept as an example in `docs/example-workflows/`).
- The prompts that carry the book-writing craft rules are in the code, but the rules themselves (`src/lib/ai/house-rules/`) are stand-ins here, so the live output is better than the stand-ins would give.
- I make no claim here about customer numbers.

## Repository layout

| Path | What is there |
|---|---|
| `src/app/` | Pages (request form, library, book page with the preview reader, sign-in, support, privacy) and the API routes |
| `src/app/api/generate/` | The job runner (`process`) and the watchdog (`sweep`) |
| `src/lib/ai/` | Job state and leases, kickoff, the Gemini client and one module per stage (outline, front matter, chapter, edit, cover, preview) |
| `src/lib/build/` | The quality gate, markdown parsing, EPUB and PDF builders, front matter |
| `src/lib/` | Preview rules, request checks, email rules, pricing, captcha, token verification, mail |
| `tests/` | The test suite and the in-memory Firestore stand-in |
| `firestore.rules`, `firestore.indexes.json` | Security rules and indexes |
| `docs/` | Architecture notes, engineering log, an example workflow |
| `scripts/` | Operator scripts from the earlier manual flow (they need a local service account file, which is not included) |

## Running it

```bash
npm ci
npm test
```

The tests were run on Node 24. To run the app you need a Firebase project, a Gemini key, a Stripe account and a mailbox. Copy `.env.example` to `.env.local` and fill it in. With `GEMINI_PIPELINE_ENABLED` unset the app never starts a generation job.

## Licence

All rights reserved. This repository is published so that it can be read and evaluated. See [LICENSE](LICENSE).
