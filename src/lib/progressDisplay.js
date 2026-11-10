// Shared by the server (jobs.js writes real progress inside these bands)
// and the book page (which shows it). No server-only imports here.

// Where each free-preview stage sits on the 0-100 bar, sized by how long
// each stage really takes (planning, which includes About the Author and
// the Introduction, is the longest), so no stage sits still for long.
// Fixing only runs when the quality check trips; otherwise the bar jumps
// from editing's end to saving.
export const PREVIEW_STAGE_BANDS = {
  planning: [0, 38],
  drafting: [38, 68],
  editing: [68, 88],
  fixing: [88, 96],
  saving: [96, 100],
};

// Typical duration of each preview stage, from real runs on 2026-10-15.
const PREVIEW_STAGE_SECONDS = {
  planning: 110,
  drafting: 85,
  editing: 88,
  fixing: 75,
  saving: 5,
};

/**
 * The percentage to show for a job (unrounded, for a smooth bar width).
 * Real progress only arrives in bursts (Gemini thinks silently for up to a
 * minute before writing), and a bar that sits still is where a waiting
 * visitor gives up. So during a free preview the number also climbs with
 * time inside the current stage: halfway through the stage's range at its
 * typical duration, then ever slower, so a slow run keeps moving instead
 * of stalling early, but it never reaches the stage's end; only the server
 * moves the bar into the next stage. Both parts only grow within a stage
 * and each stage starts above the previous one's ceiling, so the number
 * never goes backwards (checked against real and slowed-down timelines).
 */
export function displayProgress(job, now) {
  const real = job?.progress ?? 0;
  if (!job || job.status !== "running" || job.type !== "preview") return real;
  const band = PREVIEW_STAGE_BANDS[job.stage];
  if (!band) return real;
  const [from, to] = band;
  const stageStart = Date.parse(job.stageStartedAt || job.updatedAt || job.startedAt);
  const x = Math.max(0, (now - stageStart) / 1000) / PREVIEW_STAGE_SECONDS[job.stage];
  const ceiling = to - 1;
  const byTime = from + (ceiling - from) * (x / (1 + x));
  return Math.min(ceiling, Math.max(real, byTime));
}
