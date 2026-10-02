import { and, cosineDistance, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { embedText } from "./ai";

const { memories, episodes } = schema;

export type RecallHit = {
  type: "memory" | "episode";
  id: string;
  text: string;
  kind: string;
  similarity: number;
  score: number;
  at: string;
};

const CANDIDATES = 20;
const RECENCY_HALF_LIFE_DAYS = 30;

export function rankScore(similarity: number, ageDays: number, confidence: number) {
  const recency = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
  return 0.7 * similarity + 0.2 * recency + 0.1 * confidence;
}

export async function recall(learnerId: string, query: string, k = 8, now = new Date()): Promise<RecallHit[]> {
  const q = await embedText(query);
  const memSim = sql<number>`1 - (${cosineDistance(memories.embedding, q)})`;
  const epSim = sql<number>`1 - (${cosineDistance(episodes.embedding, q)})`;

  const [memRows, epRows] = await Promise.all([
    db
      .select({
        id: memories.id,
        text: memories.statement,
        kind: memories.kind,
        confidence: memories.confidence,
        at: memories.lastConfirmedAt,
        similarity: memSim,
      })
      .from(memories)
      .where(
        and(
          eq(memories.learnerId, learnerId),
          inArray(memories.status, ["active", "resolved"]),
          isNotNull(memories.embedding),
        ),
      )
      .orderBy(cosineDistance(memories.embedding, q))
      .limit(CANDIDATES),
    db
      .select({ id: episodes.id, text: episodes.summary, kind: episodes.scope, at: episodes.periodEnd, similarity: epSim })
      .from(episodes)
      .where(and(eq(episodes.learnerId, learnerId), isNotNull(episodes.embedding)))
      .orderBy(cosineDistance(episodes.embedding, q))
      .limit(CANDIDATES),
  ]);

  const age = (d: Date) => (now.getTime() - d.getTime()) / 86_400_000;
  const hits: RecallHit[] = [
    ...memRows.map((r) => ({
      type: "memory" as const,
      id: r.id,
      text: r.text,
      kind: r.kind,
      similarity: Number(r.similarity),
      score: rankScore(Number(r.similarity), age(r.at), r.confidence),
      at: r.at.toISOString(),
    })),
    ...epRows.map((r) => ({
      type: "episode" as const,
      id: r.id,
      text: r.text,
      kind: r.kind,
      similarity: Number(r.similarity),
      score: rankScore(Number(r.similarity), age(r.at), 1),
      at: r.at.toISOString(),
    })),
  ];
  return hits.sort((a, b) => b.score - a.score).slice(0, k);
}
