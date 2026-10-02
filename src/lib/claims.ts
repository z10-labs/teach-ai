import { STRENGTH_WEIGHT, type Extraction, type ExtractionContext } from "./ai";
import type { Claim } from "./merge";

export type SessionContext = ExtractionContext & {
  learnerId: string;
  startedAt: string;
  endedAt: string | null;
  segmentIds: Record<number, string>;
};

/** Per-quote weight such that the quotes' noisy-OR equals the claim's overall strength. */
export function splitWeight(strength: number, quotes: number): number {
  return 1 - Math.pow(1 - strength, 1 / Math.max(1, quotes));
}

/** Converts LLM output into claims, dropping ids that aren't in the catalog or the learner's memory. */
export function toClaims(extraction: Extraction, ctx: SessionContext): Claim[] {
  const skillIds = new Set(ctx.skills.map((s) => s.id));
  const mcById = new Map(ctx.misconceptions.map((m) => [m.id, m]));
  const memoryKind = new Map(ctx.existingMemories.map((m) => [m.id, m.kind]));

  return extraction.claims.flatMap((c): Claim[] => {
    const cited = c.evidence.filter((e) => ctx.segmentIds[e.segmentIdx]);
    const seen = new Set<number>();
    const unique = cited.filter((e) => !seen.has(e.segmentIdx) && seen.add(e.segmentIdx));
    if (unique.length === 0) return [];

    const w = splitWeight(STRENGTH_WEIGHT[c.strength], unique.length);
    const evidence = unique.map((e) => ({
      sourceType: "segment" as const,
      sourceId: ctx.segmentIds[e.segmentIdx],
      weight: w,
      quote: e.quote.slice(0, 500),
    }));

    const mc = c.kind === "misconception" && c.misconceptionId ? mcById.get(c.misconceptionId) : undefined;
    const skillId = mc?.skillId ?? (c.skillId && skillIds.has(c.skillId) ? c.skillId : null);
    const target = c.existingMemoryId && memoryKind.get(c.existingMemoryId) === c.kind ? c.existingMemoryId : undefined;

    return [
      {
        kind: c.kind,
        skillId,
        misconceptionId: mc?.id ?? null,
        statement: c.statement,
        attributes: c.deadline ? { deadline: c.deadline } : {},
        relation: c.relation,
        evidence,
        targetMemoryId: target,
      },
    ];
  });
}
