import { describe, expect, it } from "vitest";
import { confidenceFromEvidence } from "./confidence";
import { findMatch, planMerge, type Claim, type ExistingMemory } from "./merge";

const ev = (id: string, weight: number) => ({ sourceType: "event" as const, sourceId: id, weight });

const misconception = (over: Partial<ExistingMemory> = {}): ExistingMemory => ({
  id: "m1",
  kind: "misconception",
  skillId: "math.ratio.part_whole",
  misconceptionId: "ratio.part_part_vs_whole",
  statement: "Treats part-to-part ratios as part-to-whole",
  status: "active",
  embedding: null,
  evidence: [{ relation: "supports", weight: 0.6, sourceType: "segment", sourceId: "s1" }],
  ...over,
});

const claim = (over: Partial<Claim> = {}): Claim => ({
  kind: "misconception",
  skillId: "math.ratio.part_whole",
  misconceptionId: "ratio.part_part_vs_whole",
  statement: "Confuses part-to-part with part-to-whole",
  relation: "supports",
  evidence: [ev("e1", 0.25)],
  ...over,
});

describe("confidenceFromEvidence", () => {
  it("combines supporting evidence with noisy-OR", () => {
    expect(confidenceFromEvidence([{ relation: "supports", weight: 0.5 }, { relation: "supports", weight: 0.5 }])).toBeCloseTo(0.75);
  });
  it("discounts by contradicting evidence", () => {
    expect(
      confidenceFromEvidence([
        { relation: "supports", weight: 0.8 },
        { relation: "contradicts", weight: 0.5 },
      ]),
    ).toBeCloseTo(0.4);
  });
});

describe("findMatch", () => {
  it("matches on catalog misconception id regardless of wording", () => {
    expect(findMatch([misconception()], claim())?.id).toBe("m1");
  });

  it("does not match across different skills", () => {
    expect(findMatch([misconception()], claim({ skillId: "math.fractions.add", misconceptionId: null }))).toBeNull();
  });

  it("falls back to lexical similarity for free-text memories", () => {
    const existing = misconception({ misconceptionId: null, statement: "Draws tape diagrams to set up ratio problems" });
    const c = claim({ kind: "misconception", misconceptionId: null, statement: "Draws tape diagrams to set up ratio word problems" });
    expect(findMatch([existing], c)?.id).toBe("m1");
  });

  it("uses embeddings when both sides have them", () => {
    const existing = misconception({ misconceptionId: null, embedding: [1, 0, 0] });
    expect(findMatch([existing], claim({ misconceptionId: null, embedding: [0.99, 0.1, 0] }))?.id).toBe("m1");
    expect(findMatch([existing], claim({ misconceptionId: null, embedding: [0, 1, 0] }))).toBeNull();
  });

  it("ignores superseded memories and honours targetMemoryId", () => {
    expect(findMatch([misconception({ status: "superseded" })], claim())).toBeNull();
    expect(findMatch([misconception()], claim({ targetMemoryId: "m1", misconceptionId: "other" }))?.id).toBe("m1");
  });
});

describe("planMerge", () => {
  it("adds weakly-evidenced new claims as proposed", () => {
    const plan = planMerge([], claim());
    expect(plan).toMatchObject({ action: "add", status: "proposed" });
  });

  it("adds strongly-evidenced new claims as active", () => {
    const plan = planMerge([], claim({ evidence: [ev("e1", 0.7)] }));
    expect(plan).toMatchObject({ action: "add", status: "active" });
  });

  it("ignores contradictions with nothing to contradict", () => {
    expect(planMerge([], claim({ relation: "contradicts" })).action).toBe("ignore");
  });

  it("strengthens an existing memory with new evidence", () => {
    const plan = planMerge([misconception()], claim());
    expect(plan.action).toBe("update");
    if (plan.action === "update") expect(plan.confidence).toBeGreaterThan(0.6);
  });

  it("is idempotent for evidence already recorded", () => {
    const plan = planMerge([misconception()], claim({ evidence: [{ sourceType: "segment", sourceId: "s1", weight: 0.6 }] }));
    expect(plan).toMatchObject({ action: "ignore", reason: "evidence already recorded" });
  });

  it("never revives a memory a tutor dismissed", () => {
    expect(planMerge([misconception({ status: "dismissed" })], claim())).toMatchObject({ action: "ignore" });
  });

  it("resolves a misconception once contradicting evidence outweighs support", () => {
    let mem = misconception();
    let status = mem.status;
    for (let i = 0; i < 10 && status === "active"; i++) {
      const plan = planMerge([mem], claim({ relation: "contradicts", targetMemoryId: "m1", evidence: [ev(`c${i}`, 0.15)] }));
      if (plan.action !== "update") throw new Error("expected update");
      mem = {
        ...mem,
        status: plan.status,
        evidence: [...mem.evidence, { relation: "contradicts", weight: 0.15, sourceType: "event", sourceId: `c${i}` }],
      };
      status = plan.status;
    }
    expect(status).toBe("resolved");
  });

  it("expires non-misconception memories instead of resolving them", () => {
    const strategy = misconception({ kind: "strategy_works", misconceptionId: null });
    const plan = planMerge([strategy], {
      ...claim({ kind: "strategy_works", misconceptionId: null }),
      relation: "contradicts",
      targetMemoryId: "m1",
      evidence: [ev("c1", 0.9)],
    });
    expect(plan).toMatchObject({ action: "update", status: "expired" });
  });

  it("re-activates a resolved misconception when it reappears", () => {
    const resolved = misconception({
      status: "resolved",
      evidence: [{ relation: "supports", weight: 0.3, sourceType: "event", sourceId: "x" }],
    });
    const plan = planMerge([resolved], claim({ evidence: [ev("e2", 0.7)] }));
    expect(plan).toMatchObject({ action: "update", status: "active" });
  });
});
