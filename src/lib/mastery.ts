/**
 * Bayesian Knowledge Tracing: P(known) per learner per skill, updated per answer.
 */
export type BktParams = {
  pInit: number;
  pLearn: number;
  pSlip: number;
  pGuess: number;
};

export const DEFAULT_BKT: BktParams = { pInit: 0.2, pLearn: 0.15, pSlip: 0.1, pGuess: 0.2 };

export function bktUpdate(pKnown: number, correct: boolean, p: BktParams = DEFAULT_BKT): number {
  const posterior = correct
    ? (pKnown * (1 - p.pSlip)) / (pKnown * (1 - p.pSlip) + (1 - pKnown) * p.pGuess)
    : (pKnown * p.pSlip) / (pKnown * p.pSlip + (1 - pKnown) * (1 - p.pGuess));
  return clamp01(posterior + (1 - posterior) * p.pLearn);
}

export type SkillStateInput = {
  mastery: number;
  attempts: number;
  recentMastery: number[];
};

export type SkillStateUpdate = SkillStateInput & {
  confidence: number;
  trend: "up" | "flat" | "down";
  nextReviewAt: Date;
};

const RECENT_WINDOW = 10;
const TREND_LOOKBACK = 5;
const TREND_EPSILON = 0.05;

/** A correct answer that needed hints is not evidence of independent mastery. */
export function answerCounts(correct: boolean, hintsUsed: number): boolean {
  return correct && hintsUsed === 0;
}

export function applyAnswer(
  prev: SkillStateInput | null,
  correct: boolean,
  at: Date,
  params: BktParams = DEFAULT_BKT,
): SkillStateUpdate {
  const start = prev ?? { mastery: params.pInit, attempts: 0, recentMastery: [] };
  const mastery = bktUpdate(start.mastery, correct, params);
  const recentMastery = [...start.recentMastery, mastery].slice(-RECENT_WINDOW);
  const attempts = start.attempts + 1;
  return {
    mastery,
    attempts,
    recentMastery,
    confidence: attempts / (attempts + 5),
    trend: trendOf(recentMastery),
    nextReviewAt: new Date(at.getTime() + reviewIntervalDays(mastery) * DAY_MS),
  };
}

export function trendOf(series: number[]): "up" | "flat" | "down" {
  if (series.length < 2) return "flat";
  const from = series[Math.max(0, series.length - 1 - TREND_LOOKBACK)];
  const delta = series[series.length - 1] - from;
  if (delta > TREND_EPSILON) return "up";
  if (delta < -TREND_EPSILON) return "down";
  return "flat";
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function reviewIntervalDays(mastery: number): number {
  if (mastery < 0.6) return 1;
  if (mastery < 0.8) return 3;
  if (mastery < 0.95) return 7;
  return 14;
}

function clamp01(x: number) {
  return Math.min(1, Math.max(0, x));
}
