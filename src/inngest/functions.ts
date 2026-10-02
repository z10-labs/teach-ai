import { eq } from "drizzle-orm";
import { cron, NonRetriableError } from "inngest";
import { db, schema } from "@/db";
import { embedTexts, extractFromTranscript } from "@/lib/ai";
import { applyEvent } from "@/lib/apply-event";
import { expireStaleMemories } from "@/lib/memory-store";
import { markMissedCommitments, memoriesMissingEmbeddings, rebuildSnapshot } from "@/lib/snapshot";
import { toClaims } from "@/lib/claims";
import { loadSessionContext, persistSessionMemory } from "@/lib/transcripts";
import { eventRecorded, inngest, memoryChanged, transcriptReady } from "./client";

const { sessions, memories } = schema;

/** Fast path: mastery, misconception rules, commitment closing. */
export const applyLearnerEvent = inngest.createFunction(
  {
    id: "apply-learner-event",
    triggers: [eventRecorded],
    concurrency: { key: "event.data.learnerId", limit: 1 },
  },
  async ({ event, step }) => {
    const result = await step.run("apply", () => applyEvent(event.data.eventId));
    if (result.status === "applied") {
      await step.sendEvent("memory-changed", memoryChanged.create({ learnerId: result.learnerId, reason: "event" }));
    }
    return result;
  },
);

/** Slow path: transcript → LLM extraction → merge into memory. */
export const processTranscript = inngest.createFunction(
  {
    id: "process-transcript",
    triggers: [transcriptReady],
    concurrency: { key: "event.data.learnerId", limit: 1 },
    retries: 3,
    onFailure: async ({ event }) => {
      const sessionId = (event.data.event.data as { sessionId: string }).sessionId;
      await db.update(sessions).set({ status: "failed" }).where(eq(sessions.id, sessionId));
    },
  },
  async ({ event, step }) => {
    const { sessionId } = event.data;
    if (!process.env.AI_GATEWAY_API_KEY) {
      throw new NonRetriableError("AI_GATEWAY_API_KEY is not set; transcript extraction is disabled");
    }

    await step.run("mark-processing", () =>
      db.update(sessions).set({ status: "processing" }).where(eq(sessions.id, sessionId)),
    );
    const ctx = await step.run("load-context", () => loadSessionContext(sessionId));
    if (ctx.segments.length === 0) return { skipped: "empty transcript" };

    const extraction = await step.run("extract", () => extractFromTranscript(ctx));
    const claims = toClaims(extraction, ctx);

    const embeddings = await step.run("embed", () => embedTexts([extraction.summary, ...claims.map((c) => c.statement)]));
    const [summaryEmbedding, ...claimEmbeddings] = embeddings;

    const result = await step.run("persist", () =>
      persistSessionMemory({
        sessionId,
        ctx,
        extraction,
        claims: claims.map((c, i) => ({ ...c, embedding: claimEmbeddings[i] })),
        summaryEmbedding,
      }),
    );

    await step.sendEvent("memory-changed", memoryChanged.create({ learnerId: ctx.learnerId, reason: "transcript" }));
    return result;
  },
);

/** Read model: debounced so bursts of events produce one rebuild. */
export const rebuildLearnerSnapshot = inngest.createFunction(
  {
    id: "rebuild-learner-snapshot",
    triggers: [memoryChanged],
    debounce: { key: "event.data.learnerId", period: "3s", timeout: "30s" },
  },
  async ({ event, step }) => {
    const { learnerId } = event.data;

    if (process.env.AI_GATEWAY_API_KEY) {
      await step.run("backfill-embeddings", async () => {
        const missing = await memoriesMissingEmbeddings(learnerId);
        const vectors = await embedTexts(missing.map((m) => m.statement));
        for (const [i, m] of missing.entries()) {
          await db.update(memories).set({ embedding: vectors[i] }).where(eq(memories.id, m.id));
        }
        return missing.length;
      });
    }

    const snapshot = await step.run("rebuild", () => rebuildSnapshot(learnerId));
    return { learnerId, asOf: snapshot.asOf };
  },
);

/** Decay and bookkeeping that no single event triggers. */
export const dailyMaintenance = inngest.createFunction(
  { id: "daily-maintenance", triggers: [cron("TZ=Africa/Johannesburg 0 2 * * *")] },
  async ({ step }) => {
    const expired = await step.run("expire-memories", () => db.transaction((tx) => expireStaleMemories(tx)));
    const missed = await step.run("mark-missed-commitments", () => markMissedCommitments());

    const learnerIds = [...new Set([...expired, ...missed].map((r) => r.learnerId))];
    if (learnerIds.length) {
      await step.sendEvent(
        "memory-changed",
        learnerIds.map((learnerId) => memoryChanged.create({ learnerId, reason: "maintenance" })),
      );
    }
    return { expired: expired.length, missed: missed.length };
  },
);

export const functions = [applyLearnerEvent, processTranscript, rebuildLearnerSnapshot, dailyMaintenance];
