import { cosineSimilarity } from "ai";
import type { MemoryKind, MemoryStatus } from "@/db/schema";
import { ACTIVATE_AT, RETIRE_BELOW, confidenceFromEvidence, type EvidenceWeight } from "./confidence";

export type EvidenceInput = {
  sourceType: "event" | "segment" | "tutor";
  sourceId: string;
  weight: number;
  quote?: string;
};

/** A candidate statement about a learner, produced by a rule or the LLM extractor. */
export type Claim = {
  kind: MemoryKind;
  skillId?: string | null;
  misconceptionId?: string | null;
  statement: string;
  attributes?: Record<string, unknown>;
  relation: "supports" | "contradicts";
  evidence: EvidenceInput[];
  embedding?: number[] | null;
  /** Skip matching and apply this claim to a known memory. */
  targetMemoryId?: string;
};

export type ExistingMemory = {
  id: string;
  kind: MemoryKind;
  skillId: string | null;
  misconceptionId: string | null;
  statement: string;
  status: MemoryStatus;
  embedding: number[] | null;
  evidence: (EvidenceWeight & { sourceType: string; sourceId: string })[];
};

export type MergePlan =
  | { action: "add"; status: "active" | "proposed"; confidence: number }
  | {
      action: "update";
      memoryId: string;
      newEvidence: EvidenceInput[];
      confidence: number;
      status: MemoryStatus;
      confirmed: boolean;
    }
  | { action: "ignore"; reason: string; memoryId?: string };

export const SIMILARITY_MATCH = 0.85;
const LEXICAL_MATCH = 0.6;

export function findMatch(existing: ExistingMemory[], claim: Claim): ExistingMemory | null {
  if (claim.targetMemoryId) return existing.find((m) => m.id === claim.targetMemoryId) ?? null;
  let best: { m: ExistingMemory; score: number } | null = null;
  for (const m of existing) {
    if (m.kind !== claim.kind || m.status === "superseded") continue;
    if (claim.skillId && m.skillId && claim.skillId !== m.skillId) continue;

    let score: number;
    if (claim.misconceptionId && m.misconceptionId) {
      if (claim.misconceptionId !== m.misconceptionId) continue;
      score = 1;
    } else {
      score = similarity(m, claim);
      const threshold = m.embedding && claim.embedding ? SIMILARITY_MATCH : LEXICAL_MATCH;
      if (score < threshold) continue;
    }
    if (m.status === "active") score += 0.01;
    if (!best || score > best.score) best = { m, score };
  }
  return best?.m ?? null;
}

export function planMerge(existing: ExistingMemory[], claim: Claim): MergePlan {
  const match = findMatch(existing, claim);

  if (!match) {
    if (claim.relation === "contradicts") return { action: "ignore", reason: "nothing to contradict" };
    const confidence = confidenceFromEvidence(claim.evidence.map((e) => ({ relation: "supports", weight: e.weight })));
    return { action: "add", status: confidence >= ACTIVATE_AT ? "active" : "proposed", confidence };
  }

  if (match.status === "dismissed") {
    return { action: "ignore", reason: "dismissed by tutor", memoryId: match.id };
  }

  const seen = new Set(match.evidence.map((e) => `${e.sourceType}:${e.sourceId}`));
  const newEvidence = claim.evidence.filter((e) => !seen.has(`${e.sourceType}:${e.sourceId}`));
  if (newEvidence.length === 0) return { action: "ignore", reason: "evidence already recorded", memoryId: match.id };

  const confidence = confidenceFromEvidence([
    ...match.evidence,
    ...newEvidence.map((e) => ({ relation: claim.relation, weight: e.weight })),
  ]);

  return {
    action: "update",
    memoryId: match.id,
    newEvidence,
    confidence,
    status: nextStatus(match, confidence),
    confirmed: claim.relation === "supports",
  };
}

function nextStatus(m: ExistingMemory, confidence: number): MemoryStatus {
  if (confidence < RETIRE_BELOW && (m.status === "active" || m.status === "proposed")) {
    return m.kind === "misconception" ? "resolved" : "expired";
  }
  if (confidence >= ACTIVATE_AT && m.status !== "active") return "active";
  return m.status;
}

function similarity(m: ExistingMemory, claim: Claim): number {
  if (m.embedding && claim.embedding) return cosineSimilarity(m.embedding, claim.embedding);
  return jaccard(tokens(m.statement), tokens(claim.statement));
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
