import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { EXTRACTOR_VERSION, type Extraction } from "./ai";
import type { SessionContext } from "./claims";
import { applyClaims, lockLearner, type MergeSummary } from "./memory-store";
import type { Claim } from "./merge";

const { sessions, transcriptSegments, skills, misconceptions, memories, commitments, episodes } = schema;

export async function loadSessionContext(sessionId: string): Promise<SessionContext> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) throw new Error(`session ${sessionId} not found`);

  const [segs, skillRows, mcRows, memRows] = await Promise.all([
    db.select().from(transcriptSegments).where(eq(transcriptSegments.sessionId, sessionId)).orderBy(asc(transcriptSegments.idx)),
    db.select({ id: skills.id, name: skills.name }).from(skills),
    db.select().from(misconceptions),
    db
      .select({ id: memories.id, kind: memories.kind, skillId: memories.skillId, statement: memories.statement })
      .from(memories)
      .where(and(eq(memories.learnerId, session.learnerId), inArray(memories.status, ["active", "proposed"]))),
  ]);

  return {
    learnerId: session.learnerId,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    skills: skillRows,
    misconceptions: mcRows,
    existingMemories: memRows,
    segments: segs.map((s) => ({ idx: s.idx, speaker: s.speaker, text: s.text })),
    segmentIds: Object.fromEntries(segs.map((s) => [s.idx, s.id])),
  };
}

export type PersistResult = { skipped: true } | { skipped: false; memory: MergeSummary; commitments: number };

/** Atomic and idempotent per session: guarded by `sessions.status = 'processed'`. */
export async function persistSessionMemory(input: {
  sessionId: string;
  ctx: SessionContext;
  extraction: Extraction;
  claims: Claim[];
  summaryEmbedding: number[] | null;
}): Promise<PersistResult> {
  const { sessionId, ctx, extraction, claims, summaryEmbedding } = input;
  const skillIds = new Set(ctx.skills.map((s) => s.id));
  const sessionEnd = new Date(ctx.endedAt ?? Date.now());

  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for("update");
    if (session.status === "processed") return { skipped: true };
    await lockLearner(tx, ctx.learnerId);

    const memory = await applyClaims(tx, ctx.learnerId, claims, EXTRACTOR_VERSION, sessionEnd);

    const commitmentRows = extraction.commitments.map((c) => ({
      learnerId: ctx.learnerId,
      sessionId,
      owner: c.owner,
      description: c.description,
      skillId: c.skillId && skillIds.has(c.skillId) ? c.skillId : null,
      dueAt: c.dueInDays != null ? new Date(sessionEnd.getTime() + c.dueInDays * 86_400_000) : null,
    }));
    if (commitmentRows.length) await tx.insert(commitments).values(commitmentRows);

    await tx
      .insert(episodes)
      .values({
        learnerId: ctx.learnerId,
        scope: "session",
        sessionId,
        periodStart: new Date(ctx.startedAt),
        periodEnd: sessionEnd,
        summary: extraction.summary,
        highlights: {
          skillsCovered: extraction.skillsCovered.filter((s) => skillIds.has(s)),
          affect: extraction.affect,
          memory,
        },
        embedding: summaryEmbedding,
      })
      .onConflictDoNothing();

    await tx
      .update(sessions)
      .set({ status: "processed", extractorVersion: EXTRACTOR_VERSION })
      .where(eq(sessions.id, sessionId));

    return { skipped: false, memory, commitments: commitmentRows.length };
  });
}
