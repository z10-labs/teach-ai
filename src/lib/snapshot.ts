import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";

const { skills, skillStates, memories, commitments, episodes, learnerSnapshots, learners } = schema;

export type LearnerSnapshot = {
  learnerId: string;
  asOf: string;
  goals: { id: string; text: string; deadline: string | null }[];
  focusSkills: { skillId: string; name: string; mastery: number; trend: string; attempts: number }[];
  strongSkills: { skillId: string; name: string; mastery: number }[];
  dueForReview: { skillId: string; name: string; dueAt: string }[];
  activeMisconceptions: { id: string; skillId: string | null; statement: string; confidence: number; verified: boolean }[];
  whatWorks: string[];
  whatDoesnt: string[];
  behavior: string[];
  preferences: string[];
  context: string[];
  openCommitments: { id: string; owner: string; text: string; dueAt: string | null }[];
  lastSession: { summary: string; at: string } | null;
  recentlyResolved: { id: string; statement: string }[];
};

const FOCUS_BELOW = 0.8;
const MIN_ATTEMPTS_FOR_STRONG = 3;
const RECENTLY_RESOLVED_DAYS = 30;

export async function buildSnapshot(learnerId: string, now = new Date()): Promise<LearnerSnapshot> {
  const since = new Date(now.getTime() - RECENTLY_RESOLVED_DAYS * 86_400_000);

  const [states, mems, resolved, openCommitments, [lastEpisode]] = await Promise.all([
    db
      .select({ s: skillStates, name: skills.name })
      .from(skillStates)
      .innerJoin(skills, eq(skills.id, skillStates.skillId))
      .where(eq(skillStates.learnerId, learnerId)),
    db
      .select()
      .from(memories)
      .where(and(eq(memories.learnerId, learnerId), eq(memories.status, "active")))
      .orderBy(desc(memories.confidence)),
    db
      .select({ id: memories.id, statement: memories.statement })
      .from(memories)
      .where(
        and(eq(memories.learnerId, learnerId), eq(memories.status, "resolved"), gte(memories.lastConfirmedAt, since)),
      ),
    db
      .select()
      .from(commitments)
      .where(and(eq(commitments.learnerId, learnerId), eq(commitments.status, "open")))
      .orderBy(asc(commitments.dueAt)),
    db
      .select()
      .from(episodes)
      .where(and(eq(episodes.learnerId, learnerId), eq(episodes.scope, "session")))
      .orderBy(desc(episodes.periodEnd))
      .limit(1),
  ]);

  const statementsOf = (kind: string) => mems.filter((m) => m.kind === kind).map((m) => m.statement);

  return {
    learnerId,
    asOf: now.toISOString(),
    goals: mems
      .filter((m) => m.kind === "goal")
      .map((m) => ({ id: m.id, text: m.statement, deadline: (m.attributes.deadline as string | undefined) ?? null })),
    focusSkills: states
      .filter(({ s }) => s.mastery < FOCUS_BELOW)
      .sort((a, b) => a.s.mastery - b.s.mastery)
      .map(({ s, name }) => ({ skillId: s.skillId, name, mastery: round(s.mastery), trend: s.trend, attempts: s.attempts })),
    strongSkills: states
      .filter(({ s }) => s.mastery >= FOCUS_BELOW && s.attempts >= MIN_ATTEMPTS_FOR_STRONG)
      .map(({ s, name }) => ({ skillId: s.skillId, name, mastery: round(s.mastery) })),
    dueForReview: states
      .filter(({ s }) => s.nextReviewAt && s.nextReviewAt <= now)
      .map(({ s, name }) => ({ skillId: s.skillId, name, dueAt: s.nextReviewAt!.toISOString() })),
    activeMisconceptions: mems
      .filter((m) => m.kind === "misconception")
      .map((m) => ({
        id: m.id,
        skillId: m.skillId,
        statement: m.statement,
        confidence: round(m.confidence),
        verified: m.verifiedByTutor,
      })),
    whatWorks: statementsOf("strategy_works"),
    whatDoesnt: statementsOf("strategy_fails"),
    behavior: statementsOf("behavior"),
    preferences: statementsOf("preference"),
    context: statementsOf("context"),
    openCommitments: openCommitments.map((c) => ({
      id: c.id,
      owner: c.owner,
      text: c.description,
      dueAt: c.dueAt?.toISOString() ?? null,
    })),
    lastSession: lastEpisode ? { summary: lastEpisode.summary, at: lastEpisode.periodEnd.toISOString() } : null,
    recentlyResolved: resolved,
  };
}

export async function rebuildSnapshot(learnerId: string): Promise<LearnerSnapshot> {
  const snapshot = await buildSnapshot(learnerId);
  await db
    .insert(learnerSnapshots)
    .values({ learnerId, snapshot, builtAt: new Date(snapshot.asOf) })
    .onConflictDoUpdate({ target: learnerSnapshots.learnerId, set: { snapshot, builtAt: new Date(snapshot.asOf) } });
  return snapshot;
}

/** Reads the stored snapshot, building it on first access. */
export async function getSnapshot(learnerId: string): Promise<LearnerSnapshot | null> {
  const [row] = await db.select().from(learnerSnapshots).where(eq(learnerSnapshots.learnerId, learnerId));
  if (row) return row.snapshot as LearnerSnapshot;
  const [learner] = await db.select({ id: learners.id }).from(learners).where(eq(learners.id, learnerId));
  return learner ? rebuildSnapshot(learnerId) : null;
}

export async function markMissedCommitments(now = new Date()) {
  return db
    .update(commitments)
    .set({ status: "missed" })
    .where(and(eq(commitments.status, "open"), lte(commitments.dueAt, now)))
    .returning({ learnerId: commitments.learnerId });
}

export async function memoriesMissingEmbeddings(learnerId: string) {
  return db
    .select({ id: memories.id, statement: memories.statement })
    .from(memories)
    .where(
      and(
        eq(memories.learnerId, learnerId),
        inArray(memories.status, ["active", "proposed"]),
        isNull(memories.embedding),
      ),
    );
}

function round(x: number) {
  return Math.round(x * 100) / 100;
}
