import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { TUTOR_VERIFY_WEIGHT, confidenceFromEvidence } from "./confidence";
import { lockLearner } from "./memory-store";

const { memories, memoryEvidence } = schema;

export type TutorAction =
  | { action: "verify"; tutorId: string }
  | { action: "dismiss"; tutorId: string }
  | { action: "edit"; tutorId: string; statement: string };

/** Returns the learner id whose memory changed, or null if the memory doesn't exist. */
export async function applyTutorAction(memoryId: string, input: TutorAction): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [mem] = await tx.select().from(memories).where(eq(memories.id, memoryId));
    if (!mem) return null;
    await lockLearner(tx, mem.learnerId);

    if (input.action === "dismiss") {
      await tx.update(memories).set({ status: "dismissed" }).where(eq(memories.id, memoryId));
      return mem.learnerId;
    }

    const tutorEvidence = {
      sourceType: "tutor" as const,
      sourceId: input.tutorId,
      relation: "supports" as const,
      weight: TUTOR_VERIFY_WEIGHT,
    };

    if (input.action === "verify") {
      await tx.insert(memoryEvidence).values({ memoryId, ...tutorEvidence }).onConflictDoNothing();
      const ev = await tx.select().from(memoryEvidence).where(eq(memoryEvidence.memoryId, memoryId));
      await tx
        .update(memories)
        .set({ verifiedByTutor: true, status: "active", confidence: confidenceFromEvidence(ev), lastConfirmedAt: new Date() })
        .where(eq(memories.id, memoryId));
      return mem.learnerId;
    }

    // edit: never rewrite in place; supersede with a new version that inherits the evidence.
    const [next] = await tx
      .insert(memories)
      .values({
        learnerId: mem.learnerId,
        kind: mem.kind,
        skillId: mem.skillId,
        misconceptionId: mem.misconceptionId,
        statement: input.statement,
        attributes: mem.attributes,
        confidence: mem.confidence,
        status: "active",
        supersedesId: mem.id,
        createdBy: `tutor:${input.tutorId}`,
        verifiedByTutor: true,
        firstSeenAt: mem.firstSeenAt,
        expiresAt: mem.expiresAt,
      })
      .returning();
    const ev = await tx.select().from(memoryEvidence).where(eq(memoryEvidence.memoryId, memoryId));
    await tx
      .insert(memoryEvidence)
      .values([
        ...ev.map((e) => ({
          memoryId: next.id,
          sourceType: e.sourceType,
          sourceId: e.sourceId,
          relation: e.relation,
          weight: e.weight,
          quote: e.quote,
        })),
        { memoryId: next.id, ...tutorEvidence },
      ])
      .onConflictDoNothing();
    const all = await tx.select().from(memoryEvidence).where(eq(memoryEvidence.memoryId, next.id));
    await tx.update(memories).set({ confidence: confidenceFromEvidence(all) }).where(eq(memories.id, next.id));
    await tx.update(memories).set({ status: "superseded" }).where(eq(memories.id, mem.id));
    return mem.learnerId;
  });
}
