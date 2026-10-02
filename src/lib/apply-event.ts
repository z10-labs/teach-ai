import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { learnerEvent } from "./events";
import { answerCounts, applyAnswer } from "./mastery";
import { applyClaims, lockLearner, type MergeSummary } from "./memory-store";
import type { Claim } from "./merge";

const { events, skillStates, memories, misconceptions, commitments } = schema;

/** One tagged wrong answer is weak evidence; a pattern of them is strong. */
export const MISCONCEPTION_ANSWER_WEIGHT = 0.25;
/** A clean correct answer weakens active misconceptions on that skill. */
export const CORRECT_CONTRADICTS_WEIGHT = 0.15;

export type ApplyEventResult =
  | { status: "skipped"; reason: string }
  | {
      status: "applied";
      learnerId: string;
      skillsUpdated: string[];
      commitmentsClosed: number;
      memory: MergeSummary | null;
    };

/** Idempotent: an event is applied at most once, guarded by `events.processed_at`. */
export async function applyEvent(eventId: string): Promise<ApplyEventResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
    if (!row) return { status: "skipped", reason: "not found" };
    if (row.processedAt) return { status: "skipped", reason: "already processed" };

    await lockLearner(tx, row.learnerId);
    const event = learnerEvent.parse({
      id: row.id,
      learnerId: row.learnerId,
      type: row.type,
      payload: row.payload,
    });
    const at = row.occurredAt;
    const skillsUpdated: string[] = [];
    let commitmentsClosed = 0;
    let memory: MergeSummary | null = null;

    if (event.type === "question.answered") {
      const { skillIds, correct, hintsUsed, misconceptionId } = event.payload;
      const counted = answerCounts(correct, hintsUsed);

      const prev = await tx
        .select()
        .from(skillStates)
        .where(and(eq(skillStates.learnerId, row.learnerId), inArray(skillStates.skillId, skillIds)));

      for (const skillId of skillIds) {
        const p = prev.find((s) => s.skillId === skillId) ?? null;
        const next = applyAnswer(p, counted, at);
        await tx
          .insert(skillStates)
          .values({ learnerId: row.learnerId, skillId, ...next, lastPracticedAt: at, lastEventId: row.id, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: [skillStates.learnerId, skillStates.skillId],
            set: { ...next, lastPracticedAt: at, lastEventId: row.id, updatedAt: new Date() },
          });
        skillsUpdated.push(skillId);
      }

      const claims: Claim[] = [];
      if (!correct && misconceptionId) {
        const [mc] = await tx.select().from(misconceptions).where(eq(misconceptions.id, misconceptionId));
        if (mc) {
          claims.push({
            kind: "misconception",
            skillId: mc.skillId,
            misconceptionId: mc.id,
            statement: mc.description,
            relation: "supports",
            evidence: [{ sourceType: "event", sourceId: row.id, weight: MISCONCEPTION_ANSWER_WEIGHT }],
          });
        }
      }
      if (counted) {
        const active = await tx
          .select({ id: memories.id })
          .from(memories)
          .where(
            and(
              eq(memories.learnerId, row.learnerId),
              eq(memories.kind, "misconception"),
              inArray(memories.status, ["active", "proposed"]),
              inArray(memories.skillId, skillIds),
            ),
          );
        for (const m of active) {
          claims.push({
            kind: "misconception",
            statement: "",
            relation: "contradicts",
            targetMemoryId: m.id,
            evidence: [{ sourceType: "event", sourceId: row.id, weight: CORRECT_CONTRADICTS_WEIGHT }],
          });
        }
      }
      if (claims.length > 0) memory = await applyClaims(tx, row.learnerId, claims, "rule:answers", at);
    }

    if (event.type === "lesson.completed") {
      const closed = await tx
        .update(commitments)
        .set({ status: "done", closedByEventId: row.id })
        .where(
          and(
            eq(commitments.learnerId, row.learnerId),
            eq(commitments.status, "open"),
            eq(commitments.owner, "student"),
            inArray(commitments.skillId, event.payload.skillIds),
          ),
        )
        .returning({ id: commitments.id });
      commitmentsClosed = closed.length;
    }

    await tx.update(events).set({ processedAt: new Date() }).where(eq(events.id, row.id));
    return { status: "applied", learnerId: row.learnerId, skillsUpdated, commitmentsClosed, memory };
  });
}
