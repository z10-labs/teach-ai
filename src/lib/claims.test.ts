import { describe, expect, it } from "vitest";
import type { Extraction } from "./ai";
import { splitWeight, toClaims, type SessionContext } from "./claims";
import { confidenceFromEvidence } from "./confidence";

const ctx: SessionContext = {
  learnerId: "l1",
  startedAt: "2026-10-02T10:00:00Z",
  endedAt: "2026-10-02T11:00:00Z",
  skills: [{ id: "math.ratio.part_whole", name: "Part/whole" }],
  misconceptions: [{ id: "ratio.part_part_vs_whole", skillId: "math.ratio.part_whole", description: "…" }],
  existingMemories: [{ id: "mem-goal", kind: "goal", skillId: null, statement: "Pass finals" }],
  segments: [],
  segmentIds: { 0: "seg-0", 1: "seg-1", 2: "seg-2" },
};

type RawClaim = Extraction["claims"][number];
const raw = (over: Partial<RawClaim>): RawClaim => ({
  kind: "misconception",
  skillId: null,
  misconceptionId: "ratio.part_part_vs_whole",
  statement: "Reads 3:2 as 3/2",
  relation: "supports",
  existingMemoryId: null,
  strength: "strong",
  deadline: null,
  evidence: [{ segmentIdx: 1, quote: "I just put 3 over 2" }],
  ...over,
});
const extraction = (claims: RawClaim[]): Extraction => ({ summary: "", skillsCovered: [], claims, commitments: [], affect: null });

describe("splitWeight", () => {
  it("preserves overall strength under noisy-OR", () => {
    const w = splitWeight(0.7, 3);
    expect(confidenceFromEvidence([1, 2, 3].map(() => ({ relation: "supports" as const, weight: w })))).toBeCloseTo(0.7);
  });
});

describe("toClaims", () => {
  it("maps catalog misconceptions and inherits their skill", () => {
    const [c] = toClaims(extraction([raw({})]), ctx);
    expect(c).toMatchObject({ misconceptionId: "ratio.part_part_vs_whole", skillId: "math.ratio.part_whole" });
    expect(c.evidence[0]).toMatchObject({ sourceType: "segment", sourceId: "seg-1", weight: 0.7 });
  });

  it("drops invented ids instead of trusting them", () => {
    const [c] = toClaims(extraction([raw({ misconceptionId: "made.up", skillId: "math.nope" })]), ctx);
    expect(c.misconceptionId).toBeNull();
    expect(c.skillId).toBeNull();
  });

  it("drops claims whose evidence cites no real segment", () => {
    expect(toClaims(extraction([raw({ evidence: [{ segmentIdx: 99, quote: "x" }] })]), ctx)).toHaveLength(0);
  });

  it("dedupes repeated citations of the same segment", () => {
    const [c] = toClaims(
      extraction([raw({ evidence: [{ segmentIdx: 1, quote: "a" }, { segmentIdx: 1, quote: "b" }, { segmentIdx: 2, quote: "c" }] })]),
      ctx,
    );
    expect(c.evidence.map((e) => e.sourceId)).toEqual(["seg-1", "seg-2"]);
  });

  it("only targets existing memories of the same kind", () => {
    const [wrongKind] = toClaims(extraction([raw({ existingMemoryId: "mem-goal" })]), ctx);
    expect(wrongKind.targetMemoryId).toBeUndefined();
    const [goal] = toClaims(
      extraction([raw({ kind: "goal", misconceptionId: null, existingMemoryId: "mem-goal", deadline: "2026-11-14" })]),
      ctx,
    );
    expect(goal).toMatchObject({ targetMemoryId: "mem-goal", attributes: { deadline: "2026-11-14" }, misconceptionId: null });
  });
});
