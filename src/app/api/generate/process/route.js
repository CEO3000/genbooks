// The real backend controller the PDF spec asks for. One call here does
// exactly one unit of work (one chapter, one stage transition), updates
// generationJobs/{jobId} in Firestore, then triggers itself again if more
// work remains. The frontend never drives this beyond the initial kickoff
// and its stall check; it only ever reads job state.
//
// HONEST STATE (do not remove this note until it's no longer true):
// VALIDATING, PLANNING, WRITING, EDITING, COVER and SAVING are all real.
// PLANNING also generates real front matter (About The Author + the
// introduction, via generateFrontMatter.js) alongside the outline;
// copyright and the chapter-outline page are pure templates
// (buildFrontMatter.js), no Gemini call needed for those two. EDITING
// runs every chapter through a mechanical hard-rule gate (gate.js: em
// dashes, banned machine-voice phrases, leftover VERIFY/placeholder
// markers) with one targeted repair pass before the step fails and is
// retried — there is no human editor in this pipeline to catch what the
// prompt alone fails to enforce. COVER produces the front (ebook) cover
// only, via Gemini's native image endpoint (generateCover.js), and SAVING
// embeds it into the built EPUB. The back cover / full paperback wrap
// still throws (generateBackCover), since that needs real trim-size/
// spine-width math tied to the PDF's actual page count, not built yet.
// A separate, much shorter job type ("preview") handles the free excerpt
// shown before any payment, kicked off automatically by
// /api/requests/create right after a new request is submitted.
//
// RELIABILITY: the route acknowledges at once and does the step inside
// after(), under a lease (jobs.js claimStep) so only one worker ever runs a
// job, with a hard deadline below maxDuration so a slow Gemini call is
// aborted and retried instead of the platform killing the function
// silently. Failed steps retry with backoff (jobs.js RETRY_DELAYS_MS);
// anything that still slips through (a lost trigger, a crashed instance)
// is caught by the watchdogs: the book page's stall check and the
// scheduled sweeper (generate/sweep/route.js).

import { after } from "next/server";
import { adminDb } from "../../../../lib/firebaseAdmin.js";
import {
  updateJob, STAGES, stageProgress, PREVIEW_STAGES, previewStageProgress,
  saveOutline, saveFrontMatter, saveChapterDraft, getChapterDraft, getAllChapterDrafts, appendContinuityNote,
  claimStep, finishStep, recordStepFailure, recordUsage,
} from "../../../../lib/ai/jobs.js";
import { generateOutline } from "../../../../lib/ai/generateOutline.js";
import { generateFrontMatter } from "../../../../lib/ai/generateFrontMatter.js";
import { generateChapter } from "../../../../lib/ai/generateChapter.js";
import { generatePreviewDraft, PREVIEW_WORD_TARGET } from "../../../../lib/ai/generatePreview.js";
import { generateEdit, fixViolations } from "../../../../lib/ai/generateEdit.js";
import { findHardViolations, wordCountOffBudget } from "../../../../lib/build/gate.js";
import { generateFrontCover } from "../../../../lib/ai/generateCover.js";
import { copyrightPage, chapterOutlinePage, aboutAuthorPage, introductionPage } from "../../../../lib/build/buildFrontMatter.js";
import { buildEpub } from "../../../../lib/build/buildEpub.js";
import { buildPdf } from "../../../../lib/build/buildPdf.js";
import { saveDeliveryFile, getDeliveryFileBuffer } from "../../../../lib/ai/saveDelivery.js";
import { triggerProcessing } from "../../../../lib/ai/triggerProcessing.js";
import { notifyAdmin } from "../../../../lib/notifyAdmin.js";
import { requestRejectReason } from "../../../../lib/requestValidation.js";
import { sendDeliveryEmail } from "../../../../lib/deliveryEmail.js";

// The Hobby plan's ceiling with Fluid compute (Vercel docs). The previous
// value of 60 was shorter than a single real preview call (measured 78s),
// so every preview was killed mid-call and sat at 0% forever.
export const maxDuration = 300;
// Leaves 30s for the Firestore writes that record the outcome either way.
const STEP_DEADLINE_MS = 270_000;
// Short enough to wait out in-process; longer delays are left to the
// watchdogs so a function isn't held open doing nothing.
const MAX_IN_PROCESS_RETRY_WAIT_MS = 30_000;
const PROGRESS_WRITE_INTERVAL_MS = 4000;

const PREVIEW_EDIT_SPEC = {
  purpose: "Hook a potential reader and establish the book's premise and voice",
  takeaway: "The reader wants to keep reading",
  closingType: "forward pointer",
};

// Retrying cannot fix these, so the job fails at once instead of burning
// the retry budget.
class PermanentError extends Error {}
// Spam or junk that got past the form; failed quietly, no admin alert.
class RejectedRequest extends PermanentError {}

export async function POST(req) {
  const { jobId } = await req.json().catch(() => ({}));
  if (!jobId) return Response.json({ error: "jobId required" }, { status: 400 });

  const claim = await claimStep(jobId);
  if (!claim.claimed) {
    if (claim.reason === "gave-up") after(() => alertJobFailed(claim.job, claim.job.error));
    return Response.json({ claimed: false, reason: claim.reason });
  }

  after(() => runStep(claim.job));
  return Response.json({ claimed: true }, { status: 202 });
}

async function runStep(job) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(new Error(`Step did not finish within ${STEP_DEADLINE_MS / 1000}s and was stopped`)),
    STEP_DEADLINE_MS
  );

  try {
    const moreWork = await processOneStep(job, controller.signal);
    clearTimeout(deadline);
    await finishStep(job.jobId);
    if (moreWork) await triggerProcessing(job.jobId);
  } catch (err) {
    clearTimeout(deadline);
    console.error(`job ${job.jobId} (${job.type || "book"}/${job.stage}) attempt ${job.attempts} failed:`, err.message);
    const delay = await recordStepFailure(job, err, { permanent: err instanceof PermanentError });
    if (delay === null) {
      if (!(err instanceof RejectedRequest)) await alertJobFailed(job, err.message);
      return;
    }
    const timeLeft = STEP_DEADLINE_MS - (Date.now() - startedAt);
    if (delay <= MAX_IN_PROCESS_RETRY_WAIT_MS && delay < timeLeft) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay + 1000));
      await triggerProcessing(job.jobId);
    }
  }
}

async function alertJobFailed(job, errorMessage) {
  try {
    const book = (await adminDb().doc(`requests/${job.bookId}`).get()).data();
    if (!book) return; // an orphaned job (e.g. an old test), no customer affected
    await notifyAdmin({
      subject: `Genbooks: ${job.type === "preview" ? "a preview" : "a FULL BOOK"} failed - "${book.title || job.bookId}"`,
      text: [
        `A generation job stopped after every automatic retry and needs a look.`,
        ``,
        `Book: ${book.title || "(unknown)"} by ${book.authorName || "(unknown)"}`,
        `Paid: ${book.paid ? "YES" : "no"}`,
        `Job: ${job.jobId} (${job.type || "book"}), stage: ${job.stage}`,
        `Error: ${errorMessage}`,
        ``,
        `https://genbooks.uk/books/${job.bookId}`,
      ].join("\n"),
    });
  } catch (err) {
    console.error("alertJobFailed:", err.message);
  }
}

// Every Gemini call gets the step's deadline and records what it cost on
// the job, including calls that fail (they are billed too).
function geminiOpts(job, signal, onText) {
  return {
    signal,
    onText,
    onUsage: (usage) => recordUsage(job.jobId, usage).catch((err) => console.error("recordUsage:", err.message)),
  };
}

function hasFrontMatter(book) {
  return Boolean(String(book.aboutAuthor || "").trim() && String(book.introduction || "").trim());
}

// Same hard-rule gate as the chapters (gate.js). A violation throws, and
// the step's normal retry asks Gemini again rather than shipping it.
async function generateFrontMatterChecked(book, outline, job, signal) {
  const { aboutAuthor, introduction } = await generateFrontMatter(book, outline, geminiOpts(job, signal));
  const violations = [...findHardViolations(aboutAuthor), ...findHardViolations(introduction)];
  if (violations.length > 0) {
    throw new Error(
      "About the Author / Introduction failed the hard-rule gate: " +
      violations.map((v) => `${v.type} ("${v.match}")`).join("; ")
    );
  }
  return { aboutAuthor: aboutAuthor.trim(), introduction: introduction.trim() };
}

function hasPlan(book) {
  return Array.isArray(book.outline) && book.outline.length > 0 && book.outline.every((c) => c?.title);
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Turns streamed text into throttled progress writes, so the bar moves
// while Gemini is actually writing instead of jumping once at the end.
// Writes are chained, and settled() is awaited before the step's final
// update so a late progress write can never overwrite it.
function liveProgress(jobId, patchForWords) {
  let lastWrite = 0;
  let chain = Promise.resolve();
  return {
    onText(text) {
      const now = Date.now();
      if (now - lastWrite < PROGRESS_WRITE_INTERVAL_MS) return;
      lastWrite = now;
      const patch = patchForWords(countWords(text));
      chain = chain.then(() => updateJob(jobId, patch)).catch(() => {});
    },
    settled: () => chain,
  };
}

// Returns true when the job has more steps to run.
async function processOneStep(job, signal) {
  const db = adminDb();
  const bookDoc = await db.doc(`requests/${job.bookId}`).get();
  if (!bookDoc.exists) throw new PermanentError("The book request this job belongs to no longer exists");
  const book = bookDoc.data();

  if (job.type === "preview") {
    const rejected = requestRejectReason(book);
    if (rejected) throw new RejectedRequest(`Not generating a preview for an invalid request: ${rejected}`);
    return processPreviewStep(job, book, signal);
  }

  // Money guard, independent of how the job was started: a full book is
  // only ever written for a paid request, or one an admin explicitly
  // started (the continue route only sets continueRequested for admin or
  // the paid owner, and clients cannot write to requests at all).
  if (book.paid !== true && book.continueRequested !== true) {
    throw new PermanentError("Refusing to write a full book that has not been paid for");
  }

  switch (job.stage) {
    case STAGES.VALIDATING: {
      await updateJob(job.jobId, {
        stage: STAGES.PLANNING,
        progress: stageProgress(STAGES.VALIDATING, 1),
        message: "Validated, building the chapter plan",
      });
      return true;
    }

    // Outline and front matter are two separate steps, so each Gemini call
    // gets the whole step deadline to itself.
    case STAGES.PLANNING: {
      if (!job.outline) {
        await updateJob(job.jobId, { message: "Building the chapter plan" });
        // The free preview already planned this book; the buyer was shown
        // that exact contents list, so the paid book follows it.
        const outline = hasPlan(book) ? book.outline : await generateOutline(book, geminiOpts(job, signal));
        await saveOutline(job.jobId, outline);
        await updateJob(job.jobId, {
          totalChapters: outline.length,
          progress: stageProgress(STAGES.PLANNING, 0.5),
          message: `Plan ready (${outline.length} chapters), writing the introduction`,
        });
        return true;
      }

      // Written during the free preview and shown to the buyer there, so
      // the paid book uses the very same pages.
      const frontMatter = hasFrontMatter(book)
        ? { aboutAuthor: book.aboutAuthor, introduction: book.introduction }
        : await generateFrontMatterChecked(book, job.outline, job, signal);
      await saveFrontMatter(job.jobId, frontMatter);
      await updateJob(job.jobId, {
        stage: STAGES.WRITING,
        progress: stageProgress(STAGES.PLANNING, 1),
        totalChapters: job.outline.length,
        message: `Plan ready (${job.outline.length} chapters), drafting chapter 1`,
      });
      return true;
    }

    case STAGES.WRITING: {
      const nextChapter = job.currentChapter + 1;
      if (nextChapter > job.totalChapters) {
        await updateJob(job.jobId, {
          stage: STAGES.EDITING,
          progress: stageProgress(STAGES.WRITING, 1),
          message: "Drafting complete, starting revision",
        });
        return true;
      }

      const spec = job.outline.find((c) => c.number === nextChapter);
      if (!spec) throw new PermanentError(`No outline entry for chapter ${nextChapter}`);

      const continuitySummary = (job.continuityNotes || [])
        .map((n) => `Chapter ${n.number} ("${n.title}"): ${n.purpose} Ends on: ${n.takeaway}`)
        .join("\n") || "This is the first chapter — no prior continuity.";

      let previousChapterEnding = "This is the book's opening chapter.";
      if (nextChapter > 1) {
        const prev = await getChapterDraft(job.jobId, nextChapter - 1);
        if (prev?.text) previousChapterEnding = prev.text.trim().split(/\s+/).slice(-120).join(" ");
      }

      await updateJob(job.jobId, { message: `Planning chapter ${nextChapter} of ${job.totalChapters}` });
      const budget = spec.wordBudget || 2500;
      const live = liveProgress(job.jobId, (words) => ({
        progress: stageProgress(STAGES.WRITING, (nextChapter - 1 + Math.min(words / budget, 0.95)) / job.totalChapters),
        message: `Writing chapter ${nextChapter} of ${job.totalChapters}: ${words.toLocaleString("en-GB")} words so far`,
      }));
      const text = await generateChapter(
        { book, chapterSpec: spec, continuitySummary, previousChapterEnding },
        geminiOpts(job, signal, live.onText)
      );
      await live.settled();

      await saveChapterDraft(job.jobId, nextChapter, { title: spec.title, text, wordCount: countWords(text) });
      await appendContinuityNote(job.jobId, job, { number: nextChapter, title: spec.title, purpose: spec.purpose, takeaway: spec.takeaway });
      await updateJob(job.jobId, {
        currentChapter: nextChapter,
        progress: stageProgress(STAGES.WRITING, nextChapter / job.totalChapters),
        message: `Drafted chapter ${nextChapter} of ${job.totalChapters} ("${spec.title}")`,
      });
      return true;
    }

    case STAGES.EDITING: {
      // Second half of a chapter whose edit tripped the hard-rule gate
      // (gate.js): the repair pass runs as its own step, with its own full
      // deadline, rather than squeezed in after the edit.
      if (job.pendingFix) {
        const { chapter, text, violations } = job.pendingFix;
        const spec = job.outline.find((c) => c.number === chapter);
        await updateJob(job.jobId, { message: `Polishing chapter ${chapter} of ${job.totalChapters}` });
        const fixed = await fixViolations({ chapterSpec: spec, draftText: text, violations }, geminiOpts(job, signal));
        const remaining = findHardViolations(fixed);
        if (remaining.length > 0) {
          throw new Error(
            `Chapter ${chapter} still fails the hard-rule gate after a repair attempt: ` +
            remaining.map((v) => `${v.type} ("${v.match}")`).join("; ")
          );
        }
        await saveEditedChapter(job, spec, chapter, fixed);
        return true;
      }

      const nextChapter = job.currentEditChapter + 1;
      if (nextChapter > job.totalChapters) {
        await updateJob(job.jobId, {
          stage: STAGES.COVER,
          progress: stageProgress(STAGES.EDITING, 1),
          message: "Revision complete, designing the cover",
        });
        return true;
      }

      const spec = job.outline.find((c) => c.number === nextChapter);
      const draft = await getChapterDraft(job.jobId, nextChapter);
      if (!draft) throw new PermanentError(`No draft found for chapter ${nextChapter} to edit`);

      await updateJob(job.jobId, { message: `Revising chapter ${nextChapter} of ${job.totalChapters}` });
      const draftWords = countWords(draft.text) || 1;
      const live = liveProgress(job.jobId, (words) => ({
        progress: stageProgress(STAGES.EDITING, (nextChapter - 1 + Math.min(words / draftWords, 0.95)) / job.totalChapters),
        message: `Revising chapter ${nextChapter} of ${job.totalChapters}`,
      }));
      const revised = await generateEdit({ chapterSpec: spec, draftText: draft.text }, geminiOpts(job, signal, live.onText));
      await live.settled();

      const violations = findHardViolations(revised);
      if (violations.length > 0) {
        await updateJob(job.jobId, { pendingFix: { chapter: nextChapter, text: revised, violations } });
        return true;
      }
      await saveEditedChapter(job, spec, nextChapter, revised);
      return true;
    }

    case STAGES.COVER: {
      await updateJob(job.jobId, { message: "Designing the cover" });
      const { buffer, mimeType } = await generateFrontCover(book, { signal });
      await recordUsage(job.jobId, { images: 1 }).catch(() => {});
      await saveDeliveryFile(job.bookId, "front_cover", buffer, mimeType);
      await updateJob(job.jobId, {
        stage: STAGES.SAVING,
        progress: stageProgress(STAGES.COVER, 1),
        message: "Cover saved, building your files",
      });
      return true;
    }

    case STAGES.SAVING: {
      const drafts = await getAllChapterDrafts(job.jobId);
      if (drafts.length !== job.totalChapters) {
        throw new PermanentError(`SAVING: expected ${job.totalChapters} chapter drafts, found ${drafts.length}`);
      }
      if (!job.aboutAuthor || !job.introduction) {
        throw new PermanentError("SAVING: job is missing aboutAuthor/introduction from the PLANNING stage");
      }
      const bodyChapters = drafts.map((d) => ({ title: d.title, text: d.text }));
      // Front-matter order per the house publishing notes: copyright, about the
      // author (short lead-in), introduction, chapter outline, then
      // chapter one. Chapter Outline is built from the FINAL saved drafts,
      // not the planning outline, since titles can drift during writing.
      const chapters = [
        copyrightPage(book),
        aboutAuthorPage(job.aboutAuthor),
        introductionPage(job.introduction),
        chapterOutlinePage(bodyChapters),
        ...bodyChapters,
      ];
      const meta = {
        title: book.title,
        subtitle: book.subtitle || "",
        author: book.authorName,
        lang: "en",
      };

      const cover = await getDeliveryFileBuffer(job.bookId, "front_cover");
      const coverExt = cover?.mimeType === "image/jpeg" ? ".jpg" : ".png";
      const epub = await buildEpub(meta, chapters, cover?.buffer || null, coverExt);
      await saveDeliveryFile(job.bookId, "epub", epub, "application/epub+zip");
      await updateJob(job.jobId, { progress: stageProgress(STAGES.SAVING, 1 / 2), message: "EPUB saved, building PDF" });

      const pdf = await buildPdf(meta, chapters);
      await saveDeliveryFile(job.bookId, "pdf", pdf, "application/pdf");

      // Only call it delivered once the customer's files are confirmed
      // present on their own book, not just once the code reached here.
      const filesReady = (await db.doc(`requests/${job.bookId}`).get()).data()?.filesReady || {};
      if (!filesReady.epub || !filesReady.pdf) {
        throw new Error("SAVING: files were written but are not showing as ready on the book yet");
      }
      await db.doc(`requests/${job.bookId}`).update({ status: "delivered", deliveredAt: new Date().toISOString() });

      await updateJob(job.jobId, {
        status: "complete",
        stage: STAGES.COMPLETE,
        progress: 100,
        message: "Book complete",
        completedAt: new Date().toISOString(),
      });
      // Best effort here; the sweeper re-sends it if this one is lost.
      await sendDeliveryEmail(job.bookId).catch((err) => console.error("sendDeliveryEmail:", err.message));
      return false;
    }

    default:
      throw new PermanentError(`Unknown stage: ${job.stage}`);
  }
}

async function saveEditedChapter(job, spec, chapterNumber, text) {
  const wordCount = countWords(text);
  await saveChapterDraft(job.jobId, chapterNumber, { title: spec.title, text, wordCount });

  // Also a "hard failure" per prose-nlp.md, but unlike an em dash or a
  // banned phrase this isn't a visible defect a reader would ever
  // notice, and building a reliable auto-expand/trim repair pass is
  // real extra scope. Logged on the job for visibility rather than
  // failing an otherwise-good, already-paid-for book over it.
  const offBudget = wordCountOffBudget(wordCount, spec.wordBudget);
  const wordCountWarnings = offBudget
    ? [...(job.wordCountWarnings || []), `Chapter ${chapterNumber} ("${spec.title}"): ${wordCount} words vs ${spec.wordBudget} budget`]
    : job.wordCountWarnings;

  await updateJob(job.jobId, {
    currentEditChapter: chapterNumber,
    pendingFix: null,
    progress: stageProgress(STAGES.EDITING, chapterNumber / job.totalChapters),
    message: `Revised chapter ${chapterNumber} of ${job.totalChapters}`,
    ...(wordCountWarnings ? { wordCountWarnings } : {}),
  });
}

// Free preview: draft -> edit (+ a separate repair step if the hard-rule
// gate trips) -> save to requests/{id}.previewText. Runs before any
// payment.
async function processPreviewStep(job, book, signal) {
  switch (job.stage) {
    // The chapter plan, made here so the preview can show the whole book's
    // contents. Saved on the request itself, where the paid book's own
    // PLANNING stage reuses it instead of paying for a second plan.
    // Also writes About the Author and the Introduction, so the preview
    // opens the way the finished book does. Each Gemini call is its own
    // step, so each gets the full step deadline.
    case PREVIEW_STAGES.PLANNING: {
      if (!hasPlan(book)) {
        await updateJob(job.jobId, { message: "Planning your chapters" });
        const outline = await generateOutline(book, geminiOpts(job, signal));
        await adminDb().doc(`requests/${job.bookId}`).update({ outline });
        await updateJob(job.jobId, {
          // The chapter plan is about a quarter of planning's time; About
          // the Author and the Introduction are the rest.
          progress: previewStageProgress(PREVIEW_STAGES.PLANNING, 0.25),
          message: "Chapters planned, writing About the Author and the Introduction",
        });
        return true;
      }
      if (!hasFrontMatter(book)) {
        await updateJob(job.jobId, { message: "Writing About the Author and the Introduction" });
        const frontMatter = await generateFrontMatterChecked(book, book.outline, job, signal);
        await adminDb().doc(`requests/${job.bookId}`).update(frontMatter);
      }
      await updateJob(job.jobId, {
        stage: PREVIEW_STAGES.DRAFTING,
        progress: previewStageProgress(PREVIEW_STAGES.PLANNING, 1),
        message: "Chapters planned, now writing the opening pages",
      });
      return true;
    }

    case PREVIEW_STAGES.DRAFTING: {
      await updateJob(job.jobId, { message: "Planning the opening pages" });
      const live = liveProgress(job.jobId, (words) => ({
        progress: previewStageProgress(PREVIEW_STAGES.DRAFTING, Math.min(words / PREVIEW_WORD_TARGET, 0.95)),
        message: `Writing your preview: ${words.toLocaleString("en-GB")} of about ${PREVIEW_WORD_TARGET.toLocaleString("en-GB")} words`,
      }));
      const draft = await generatePreviewDraft(book, geminiOpts(job, signal, live.onText));
      await live.settled();
      await updateJob(job.jobId, {
        stage: PREVIEW_STAGES.EDITING,
        progress: previewStageProgress(PREVIEW_STAGES.DRAFTING, 1),
        message: "Draft ready, now revising it",
        previewDraft: draft,
      });
      return true;
    }

    case PREVIEW_STAGES.EDITING: {
      const draftWords = countWords(job.previewDraft) || 1;
      const live = liveProgress(job.jobId, (words) => ({
        progress: previewStageProgress(PREVIEW_STAGES.EDITING, Math.min(words / draftWords, 0.95)),
        message: "Revising your preview",
      }));
      const revised = await generateEdit({ chapterSpec: PREVIEW_EDIT_SPEC, draftText: job.previewDraft }, geminiOpts(job, signal, live.onText));
      await live.settled();

      const violations = findHardViolations(revised);
      if (violations.length > 0) {
        await updateJob(job.jobId, {
          stage: PREVIEW_STAGES.FIXING,
          progress: previewStageProgress(PREVIEW_STAGES.EDITING, 1),
          message: "Polishing the final wording",
          previewRevised: revised,
          previewViolations: violations,
        });
        return true;
      }
      await updateJob(job.jobId, {
        stage: PREVIEW_STAGES.SAVING,
        progress: previewStageProgress(PREVIEW_STAGES.FIXING, 1),
        message: "Revised, saving your preview",
        previewFinal: revised,
      });
      return true;
    }

    case PREVIEW_STAGES.FIXING: {
      const fixed = await fixViolations(
        { chapterSpec: PREVIEW_EDIT_SPEC, draftText: job.previewRevised, violations: job.previewViolations },
        geminiOpts(job, signal)
      );
      const remaining = findHardViolations(fixed);
      if (remaining.length > 0) {
        throw new Error(
          `Preview still fails the hard-rule gate after a repair attempt: ` +
          remaining.map((v) => `${v.type} ("${v.match}")`).join("; ")
        );
      }
      await updateJob(job.jobId, {
        stage: PREVIEW_STAGES.SAVING,
        progress: previewStageProgress(PREVIEW_STAGES.FIXING, 1),
        message: "Revised, saving your preview",
        previewFinal: fixed,
      });
      return true;
    }

    case PREVIEW_STAGES.SAVING: {
      const db = adminDb();
      const ref = db.doc(`requests/${job.bookId}`);
      await ref.update({ previewText: job.previewFinal, ...(book.paid ? {} : { status: "preview ready" }) });
      // Confirm delivery before calling it done.
      if (!(await ref.get()).data()?.previewText) throw new Error("Preview was saved but is not showing on the book yet");
      await updateJob(job.jobId, {
        status: "complete",
        stage: PREVIEW_STAGES.COMPLETE,
        progress: 100,
        message: "Preview ready",
        completedAt: new Date().toISOString(),
      });
      return false;
    }

    default:
      throw new PermanentError(`Unknown preview stage: ${job.stage}`);
  }
}
