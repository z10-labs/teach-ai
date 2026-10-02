import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import { getSnapshot } from "./snapshot";

const {
  learners,
  skillStates,
  skills,
  memories,
  memoryEvidence,
  transcriptSegments,
  events,
  commitments,
  episodes,
  sessions,
} = schema;

export async function listLearners() {
  await connection();
  return db.select().from(learners).orderBy(asc(learners.displayName));
}

export async function loadLearnerView(learnerId: string) {
  await connection();
  const [learner] = await db.select().from(learners).where(eq(learners.id, learnerId));
  if (!learner) return null;

  const [snapshot, states, mems, commits, eps, sess] = await Promise.all([
    getSnapshot(learnerId),
    db
      .select({ s: skillStates, name: skills.name })
      .from(skillStates)
      .innerJoin(skills, eq(skills.id, skillStates.skillId))
      .where(eq(skillStates.learnerId, learnerId))
      .orderBy(asc(skillStates.mastery)),
    db
      .select({
        id: memories.id,
        kind: memories.kind,
        skillId: memories.skillId,
        statement: memories.statement,
        confidence: memories.confidence,
        status: memories.status,
        createdBy: memories.createdBy,
        verifiedByTutor: memories.verifiedByTutor,
        supersedesId: memories.supersedesId,
        lastConfirmedAt: memories.lastConfirmedAt,
      })
      .from(memories)
      .where(eq(memories.learnerId, learnerId))
      .orderBy(desc(memories.lastConfirmedAt)),
    db.select().from(commitments).where(eq(commitments.learnerId, learnerId)).orderBy(desc(commitments.createdAt)),
    db.select().from(episodes).where(eq(episodes.learnerId, learnerId)).orderBy(desc(episodes.periodEnd)),
    db.select().from(sessions).where(eq(sessions.learnerId, learnerId)).orderBy(desc(sessions.startedAt)),
  ]);

  const evidence = mems.length
    ? await db
        .select({
          e: memoryEvidence,
          segmentText: transcriptSegments.text,
          speaker: transcriptSegments.speaker,
          eventType: events.type,
          eventPayload: events.payload,
        })
        .from(memoryEvidence)
        // evidence.source_id is polymorphic text; segments and events are uuid
        .leftJoin(transcriptSegments, eq(memoryEvidence.sourceId, sql<string>`${transcriptSegments.id}::text`))
        .leftJoin(events, eq(memoryEvidence.sourceId, sql<string>`${events.id}::text`))
        .where(
          inArray(
            memoryEvidence.memoryId,
            mems.map((m) => m.id),
          ),
        )
        .orderBy(asc(memoryEvidence.createdAt))
    : [];

  return {
    learner,
    snapshot,
    skillStates: states,
    memories: mems.map((m) => ({ ...m, evidence: evidence.filter((e) => e.e.memoryId === m.id) })),
    commitments: commits,
    episodes: eps,
    sessions: sess,
  };
}

export type LearnerView = NonNullable<Awaited<ReturnType<typeof loadLearnerView>>>;
