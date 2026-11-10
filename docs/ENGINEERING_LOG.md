# Engineering log

Real problems found while the product was built and used, taken from its commit history (4 September to 15 October 2026, 64 commits). Each entry gives the symptom, the cause, the fix and what covers it today. Where nothing covers it, it says so. The tests named here were written for this copy, after the fixes, as described in the README.

## 1. Every free preview sat at 0 percent (15 October)

**Symptom.** A visitor started a preview and the progress bar never moved. The same fault would have stopped a paid book from ever starting.

**Cause.** Three separate faults, found in the production logs.

- The platform's time limit for the step was 60 seconds, and one real preview call takes about 78. The platform killed every step in the middle of the call, with no error recorded anywhere.
- Each step handed over to the next one through the deployment's own address. Vercel's deployment protection answers that address with 401 to a server, so no job could ever pass its first step, and the watchdog that should have rescued them used the same address.
- The output limit of 8,192 tokens includes the model's thinking tokens. A "2,000 word" preview came out as 277 words, cut off in the middle of a sentence, and was saved as if it were complete.

**Fix.** Steps now run under a lease with a hard deadline shorter than the platform limit, and retry with growing waits. Responses are streamed and anything that did not finish cleanly is an error. The app reaches itself through its public address. A watchdog re-runs itself every four minutes while work exists, with two outside clocks behind it. The book page nudges a stalled job. A full book refuses to run unless it is paid for, a delivered book is never written again, and every job records its real model cost.

**Covered by.** `tests/jobs.test.mjs` (one worker per job, takeover of an expired lease, the retry schedule, giving up, the lease outlasting the platform limit), `tests/gemini.test.mjs` (truncation refused, usage recorded even on failure) and `tests/delivery.test.mjs` (the address the app calls itself on). The platform limit and deployment protection themselves can only be seen on the platform.

## 2. A repeated payment event would have written a book twice (14 September)

**Symptom.** None yet, which is why it mattered. Stripe documents that a webhook can arrive more than once, and the admin "Continue generating" button can be double-clicked. Starting a job was not checked against an existing one.

**Cause.** "Does this book already have a job" and "create one" were two separate steps, so two callers could both win. Each extra job would have paid the model for the whole book again, and nothing would have shown it until the bill.

**Fix.** Both steps now run in one Firestore transaction. A duplicate or simultaneous call gets the existing job's id back. A finished job of the same kind is never redone, while a finished free preview does not block the paid book that follows it. When this was built I checked it against the production database: two simultaneous calls returned the same job and left one document.

**Covered by.** `tests/kickoff.test.mjs`, which covers duplicate and simultaneous starts, finished and failed jobs, and the preview-then-book case. The stand-in database runs transactions one at a time, so these tests prove the logic and not Firestore's own behaviour under contention.

## 3. Unlimited free previews (14 September, reworked 15 October)

**Symptom.** Nothing stopped a visitor from asking for preview after preview, and each one is real model spend once the pipeline runs on its own.

**Cause.** The browser wrote requests straight to Firestore, so no server code was in the loop to check anything.

**Fix, in two steps.** First, request creation moved to a server route and the security rules were changed to refuse direct creation. The first rule limited a connection and an account to one unfinished request. That blocked a whole connection for ever once one unpaid preview existed, and an address is not an identity, since mobile addresses rotate. It was replaced on 15 October. A preview now needs an account with a confirmed email. Per week, one account may start a preview per connection, browser or email address in disguise (plus tags, Gmail dots). One unpaid preview per account may exist and it can be replaced once a week. Throwaway email domains are refused. Addresses and browser ids are erased after 90 days, because they are personal data.

**Covered by.** `tests/previewGate.test.mjs` and `tests/pure-modules.test.mjs`. The rules deliberately treat the address as a deterrent against casual abuse, not as proof of who someone is.

## 4. The robot check could be skipped (14 September)

**Symptom.** Found in an audit, not by a customer. A direct call to the request or support route skipped the robot check completely.

**Cause.** The check was a separate pre-flight call that produced nothing the protected routes then checked. The book form had no robot check at all.

**Fix.** The browser now sends the token with the real request, and each protected route verifies it with Cloudflare before doing anything else. The standalone endpoint is kept only for instant feedback in the form. The check fails closed: no token or no secret means no.

**Covered by.** `tests/auth.test.mjs` covers the check itself, including failing closed. Nothing automated covers the order of checks inside the routes.

## 5. One sales message pasted into every box (15 October)

**Symptom.** A live submission from a domain reseller, the same pitch in six different fields, and a word count too small to be a book.

**Fix.** A request needs at least 5,000 words, and a request is refused when the same long text appears in more than two fields. It runs when the request is created and again before any preview is paid for, which also covers requests that arrived before the rule existed.

**Covered by.** `tests/pure-modules.test.mjs`, including that short repeated answers such as "Yes" are not mistaken for spam.

## 6. Sign-in broke quietly, and my own error handling hid it (6 September)

**Symptom.** Checkout returned a server error. After the first fix, the check still failed in a way that would have shown a customer who had just paid "Invalid auth token" on the "Continue" button.

**Cause.** Adding a token check to the shared Firebase module put a static import of `firebase-admin/auth` at its top. That pulls in `jwks-rsa`, which loads the ESM build of `jose` with a plain `require`, and Vercel's bundler cannot do that. Every route that imported the file crashed at start-up, including checkout, which never uses the check. Making the import lazy did not help, because the conflict is one level deeper, and my own try/catch turned the crash into a generic "invalid token".

**Fix.** The server verifies the token itself with `jose` against Google's public keys, checking signature, issuer, audience and expiry. The routes return the underlying message as `detail`, so a failure like this is visible.

**Lesson.** A catch-all that turns any failure into "bad credentials" hides infrastructure faults as customer errors.

**Covered by.** `tests/auth.test.mjs` signs real tokens with a generated key and checks that valid ones pass, and that wrong project, expired, unsigned and foreign-key tokens fail. The bundler conflict can only be seen on the platform.

## 7. "My Books" was broken for every customer (14 September)

**Symptom.** Found in a full-site audit that I asked for, not reported by a customer. The library page stayed on "Loading" for ever, and a bad or foreign book address did the same.

**Cause.** The library asked Firestore for the whole `requests` collection and relied on the rules to filter. When a rule depends on a field of each document, Firestore refuses an unfiltered list outright, so it failed for everyone. That is not a leak, but the page was dead. Separately, the book page used `null` for both "not loaded yet" and "does not exist", and a permission-denied read fires the error callback, which nothing was listening to.

**Fix.** The query filters on the owner, which needed a composite index (my first assumption that none was needed was wrong). `undefined` now means not loaded and `null` means confirmed missing, and both listeners have error handlers.

**Also from that audit.** Four real attacks on payment gating were tried against production, and all four were blocked or priced correctly on the server: writing `paid: true` directly, continuing an unpaid book, reading a delivery file of an unpaid book, and trying to influence the price at checkout.

**Covered by.** No automated test. The rules and the pages would need the Firebase emulator and a browser, which are the next improvement.

## 8. Re-delivered books downloaded corrupted (7 September)

**Symptom.** "Could not download PDF" on a book that had been delivered twice.

**Cause.** The upload overwrote chunks 0 to N−1 but never deleted chunks left from an earlier, larger upload of the same file. The download reads every chunk it finds, so a stray chunk was appended to the new file.

**Fix.** Saving a file deletes any chunk beyond the new count.

**Covered by.** `tests/delivery.test.mjs`, which saves a large file and then a small one and checks that no stray chunk is left and the bytes match.

## 9. One third-party widget stretched every page on phones (15 September)

**Symptom.** Pages scrolled sideways on phones. The cause was found in steps, over several commits.

**Cause.** The viewport meta tag was missing site-wide. After that, the robot-check widget's fixed-width frame stretched its page. The page is a flex column, and a flex child will not shrink below the width of its content, so a wide descendant at any depth widens the whole page. Hiding horizontal overflow on `body` did not clip it, because `html` is the root scrolling box.

**Fix.** The viewport tag, a compact widget, `min-width: 0` on the wrapper and `overflow-x: hidden` on `html` as a backstop. I measured the real mechanism rather than guessing. The command-line screenshot flag did not respect the clipping a real browser applies, which misled the first attempt, so the check used a properly viewport-clipped capture.

**Covered by.** No automated test.

## 10. Registering could orphan a visitor's request (12 September)

**Symptom.** On a slow connection, creating an account could leave the visitor's half-finished book behind.

**Cause.** The form read the current user at submit time, before the anonymous sign-in had finished. It took the "create a new account" branch instead of "link this visitor to the account", so the visitor got a new identity and lost the book they had started.

**Fix.** Submission waits for the sign-in to resolve, and the "email already in use" message now points to sign-in or password reset.

**Covered by.** No automated test.

## 11. The preview reader, fitted to the real screen (6 September to 15 October)

**Symptom.** A 2,245-word preview came out as 12 pages instead of 9 or 10. Later, pages overflowed short screens, with a scrollbar inside the page and text running off the bottom.

**Cause.** The paginator never split a paragraph, so whenever the next paragraph did not fit, the rest of the page's allowance was wasted. After that, pages were cut at a fixed 200 words regardless of the frame.

**Fix.** Pagination works word by word inside a paragraph and keeps headings together. Pages are now measured in the browser, filled to what fits, and measured again on resize while the reader keeps their place.

**Covered by.** No automated test. This is browser behaviour.

## 12. A quality gate that cried wolf (14 September)

**Symptom.** Found before it shipped. The gate flagged a word in a chapter that a human had already approved.

**Cause.** "Toolkit" is banned only in its figurative sense, and a regular expression cannot tell the senses apart.

**Fix.** The gate checks only what a pattern can decide, and a group of ambiguous words was left out on purpose. Before it went in, I ran it over all 74 chapters of the three books already delivered. After that fix it found no false positives, and it caught every case in a synthetic violation string.

**Covered by.** `tests/gate.test.mjs`, which includes look-alike words that must not trip it. The 74-chapter run was a one-off script and is not in this repository.

## 13. Hourly cron rejected on the free plan (14 September)

**Symptom.** The deploy failed.

**Cause.** The account is on Vercel's free plan, which allows a cron only once a day. I had assumed hourly, and Vercel's own validation rejected it, which is why I tried it for real before relying on it.

**Fix and consequence.** The cron became daily, so on its own the watchdog could only rescue a stalled job once every 24 hours. That limit shaped the later design in entry 1: a watchdog that re-runs itself every four minutes while work exists, with a GitHub Actions schedule and the daily cron only reviving it.

**Covered by.** Not testable. It is a property of the hosting plan.

## Design decisions

These were choices rather than bugs, and each one is visible in the code.

- **Payment does not start writing.** The author presses "Continue generating" after paying. Nothing is written for a buyer who has not asked yet.
- **The preview is the first stage of the book.** It plans the chapters and writes About the Author and the Introduction, and the paid book reuses them, so the buyer gets exactly what they were shown and the plan is not paid for twice.
- **Honest progress.** The bar follows backend state and eases with time inside a stage, so it does not sit still while the model thinks silently for a minute, and it never goes backwards.
- **One door to the model.** Retry rules, limits and the key live in one file.
- **Fail loudly.** Anything that cannot be built correctly throws. The back cover, for example, needs real page counts and spine widths, so it does not guess.

## What these have in common

Almost every problem here came from real conditions that a unit test does not reach: a platform's time limit, a hosting plan's limits, protection that answers a server with 401, a bundler, a phone's screen and a payment provider that repeats itself. The tests now cover the logic that decides what happens next. The next job is to cover the platform edges with the Firestore emulator, a fake model server and browser tests.
