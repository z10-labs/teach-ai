export type EvidenceWeight = { relation: "supports" | "contradicts"; weight: number };

/**
 * Noisy-OR over supporting evidence, discounted by noisy-OR over contradicting evidence.
 * Confidence is always derived from evidence rows, never taken from the LLM directly.
 * Tutor verification is recorded as a heavy `tutor` evidence row, so later
 * contradicting evidence can still resolve a verified misconception.
 */
export function confidenceFromEvidence(evidence: EvidenceWeight[]): number {
  const support = noisyOr(evidence.filter((e) => e.relation === "supports").map((e) => e.weight));
  const contra = noisyOr(evidence.filter((e) => e.relation === "contradicts").map((e) => e.weight));
  return support * (1 - contra);
}

export const TUTOR_VERIFY_WEIGHT = 0.9;

/** Below this, an active misconception counts as resolved; other kinds expire. */
export const RETIRE_BELOW = 0.25;

/** Proposed memories are promoted to active at this confidence. */
export const ACTIVATE_AT = 0.5;

function noisyOr(weights: number[]): number {
  return 1 - weights.reduce((acc, w) => acc * (1 - clamp(w)), 1);
}

function clamp(w: number) {
  return Math.min(0.99, Math.max(0, w));
}
