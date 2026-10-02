import { describe, expect, it } from "vitest";
import { DEFAULT_BKT, answerCounts, applyAnswer, bktUpdate, reviewIntervalDays, trendOf } from "./mastery";

describe("bktUpdate", () => {
  it("raises mastery on correct answers and lowers it on incorrect ones", () => {
    const p = DEFAULT_BKT.pInit;
    expect(bktUpdate(p, true)).toBeGreaterThan(p);
    expect(bktUpdate(0.8, false)).toBeLessThan(0.8);
  });

  it("converges towards mastery after a run of correct answers", () => {
    let p = DEFAULT_BKT.pInit;
    for (let i = 0; i < 8; i++) p = bktUpdate(p, true);
    expect(p).toBeGreaterThan(0.95);
  });

  it("stays within [0, 1]", () => {
    expect(bktUpdate(0, false)).toBeGreaterThanOrEqual(0);
    expect(bktUpdate(1, true)).toBeLessThanOrEqual(1);
  });
});

describe("answerCounts", () => {
  it("does not credit hinted correct answers", () => {
    expect(answerCounts(true, 0)).toBe(true);
    expect(answerCounts(true, 2)).toBe(false);
    expect(answerCounts(false, 0)).toBe(false);
  });
});

describe("applyAnswer", () => {
  const at = new Date("2026-10-01T10:00:00Z");

  it("initialises from priors when there is no previous state", () => {
    const s = applyAnswer(null, true, at);
    expect(s.attempts).toBe(1);
    expect(s.recentMastery).toHaveLength(1);
    expect(s.mastery).toBeGreaterThan(DEFAULT_BKT.pInit);
  });

  it("caps the recent window and reports an upward trend", () => {
    let s = applyAnswer(null, false, at);
    for (let i = 0; i < 12; i++) s = applyAnswer(s, true, at);
    expect(s.recentMastery).toHaveLength(10);
    expect(s.trend).toBe("flat"); // saturated near 1
    let t = applyAnswer(null, false, at);
    for (let i = 0; i < 3; i++) t = applyAnswer(t, true, at);
    expect(t.trend).toBe("up");
  });

  it("schedules review sooner for weak skills", () => {
    const weak = applyAnswer(null, false, at);
    expect(weak.nextReviewAt.getTime() - at.getTime()).toBe(86_400_000);
  });
});

describe("trendOf / reviewIntervalDays", () => {
  it("detects down trends", () => expect(trendOf([0.9, 0.8, 0.6])).toBe("down"));
  it("maps mastery bands to intervals", () => {
    expect([0.3, 0.7, 0.9, 0.99].map(reviewIntervalDays)).toEqual([1, 3, 7, 14]);
  });
});
