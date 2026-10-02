import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { planMerge, type Claim, type ExistingMemory } from "./merge";

const { learners, memories, memoryEvidence } = schema;

export type MergeSummary = { added: number; updated: number; retired: number; ignored: number };

/** Serializes memory writes per learner for the rest of the transaction. */
export async function lockLearner(tx: Tx, learnerId: string) {
  await tx.select({ id: learners.id }).from(learners).where(eq(learners.id, learnerId)).for("update");
}

async function loadExisting(tx: Tx, learnerId: string): Promise<ExistingMemory[]> {
  const rows = await tx
    .select()
    .from(memories)
    .where(and(eq(memories.learnerId, learnerId), ne(memories.status, "superseded")));
  if (rows.length === 0) return [];
  const ev = await tx
    .select()
    .from(memoryEvidence)
    .where(
      inArray(
        memoryEvidence.memoryId,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    skillId: r.skillId,
    misconceptionId: r.misconceptionId,
    statement: r.statement,
    status: r.status,
    embedding: r.embedding,
    evidence: ev
      .filter((e) => e.memoryId === r.id)
      .map((e) => ({ relation: e.relation, weight: e.weight, sourceType: e.sourceType, sourceId: e.sourceId })),
  }));
}

/**
 * Applies claims to a learner's memory. Caller must hold the learner lock (see `lockLearner`).
 * Claims are applied in order and see each other's effects.
 */
export async function applyClaims(
  tx: Tx,
  learnerId: string,
  claims: Claim[],
  createdBy: string,
  now = new Date(),
): Promise<MergeSummary> {
  const summary: MergeSummary = { added: 0, updated: 0, retired: 0, ignored: 0 };
  const existing = await loadExisting(tx, learnerId);

  for (const claim of claims) {
    const plan = planMerge(existing, claim);

    if (plan.action === "ignore") {
      summary.ignored++;
      continue;
    }

    if (plan.action === "add") {
      const [row] = await tx
        .insert(memories)
        .values({
          learnerId,
          kind: claim.kind,
          skillId: claim.skillId ?? null,
          misconceptionId: claim.misconceptionId ?? null,
          statement: claim.statement,
          attributes: claim.attributes ?? {},
          confidence: plan.confidence,
          status: plan.status,
          createdBy,
          firstSeenAt: now,
          lastConfirmedAt: now,
          expiresAt: defaultExpiry(claim.kind, now),
          embedding: claim.embedding ?? null,
        })
        .returning();
      await insertEvidence(tx, row.id, "supports", claim.evidence);
      existing.push({
        id: row.id,
        kind: row.kind,
        skillId: row.skillId,
        misconceptionId: row.misconceptionId,
        statement: row.statement,
        status: row.status,
        embedding: row.embedding,
        evidence: claim.evidence.map((e) => ({ ...e, relation: "supports" as const })),
      });
      summary.added++;
      continue;
    }

    const target = existing.find((m) => m.id === plan.memoryId)!;
    await insertEvidence(tx, plan.memoryId, claim.relation, plan.newEvidence);
    await tx
      .update(memories)
      .set({
        confidence: plan.confidence,
        status: plan.status,
        ...(plan.confirmed ? { lastConfirmedAt: now, expiresAt: defaultExpiry(target.kind, now) } : {}),
      })
      .where(eq(memories.id, plan.memoryId));

    target.evidence.push(...plan.newEvidence.map((e) => ({ ...e, relation: claim.relation })));
    if (plan.status !== target.status && (plan.status === "resolved" || plan.status === "expired")) summary.retired++;
    else summary.updated++;
    target.status = plan.status;
  }

  return summary;
}

async function insertEvidence(
  tx: Tx,
  memoryId: string,
  relation: "supports" | "contradicts",
  evidence: Claim["evidence"],
) {
  if (evidence.length === 0) return;
  await tx
    .insert(memoryEvidence)
    .values(
      evidence.map((e) => ({
        memoryId,
        relation,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        weight: e.weight,
        quote: e.quote ?? null,
      })),
    )
    .onConflictDoNothing();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Behavioural and strategy memories fade unless re-confirmed; goals and misconceptions don't. */
function defaultExpiry(kind: Claim["kind"], now: Date): Date | null {
  switch (kind) {
    case "behavior":
    case "preference":
    case "strategy_works":
    case "strategy_fails":
      return new Date(now.getTime() + 60 * DAY_MS);
    case "context":
      return new Date(now.getTime() + 120 * DAY_MS);
    default:
      return null;
  }
}

export async function expireStaleMemories(tx: Tx, now = new Date()) {
  return tx
    .update(memories)
    .set({ status: "expired" })
    .where(
      and(
        inArray(memories.status, ["active", "proposed"]),
        sql`${memories.expiresAt} is not null and ${memories.expiresAt} < ${now.toISOString()}`,
      ),
    )
    .returning({ id: memories.id, learnerId: memories.learnerId });
}
