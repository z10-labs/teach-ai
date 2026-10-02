import { randomUUID } from "node:crypto";
import { and, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { eventRecorded, inngest } from "@/inngest/client";
import { checkAuth, parseBody } from "@/lib/api";
import { learnerEvent } from "@/lib/events";

const { events } = schema;

const body = z.union([learnerEvent, z.array(learnerEvent).min(1).max(100)]);

/**
 * Ingests learner events. Clients may supply `id` for idempotent retries;
 * re-sending an event that hasn't been processed yet re-queues it.
 */
export async function POST(req: Request) {
  const denied = checkAuth(req);
  if (denied) return denied;
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;

  const now = new Date();
  const rows = (Array.isArray(parsed.data) ? parsed.data : [parsed.data]).map((e) => ({
    id: e.id ?? randomUUID(),
    learnerId: e.learnerId,
    type: e.type,
    sessionId: e.sessionId ?? null,
    occurredAt: e.occurredAt ? new Date(e.occurredAt) : now,
    receivedAt: now,
    skillIds: e.payload.skillIds,
    payload: e.payload,
  }));

  try {
    await db.insert(events).values(rows).onConflictDoNothing();
  } catch (err) {
    if (isForeignKeyViolation(err)) return NextResponse.json({ error: "unknown learner" }, { status: 422 });
    throw err;
  }

  const pending = await db
    .select({ id: events.id, learnerId: events.learnerId })
    .from(events)
    .where(and(inArray(events.id, rows.map((r) => r.id)), isNull(events.processedAt)));

  if (pending.length) {
    await inngest.send(pending.map((p) => eventRecorded.create({ eventId: p.id, learnerId: p.learnerId })));
  }

  return NextResponse.json({ accepted: rows.map((r) => r.id), queued: pending.length }, { status: 202 });
}

function isForeignKeyViolation(err: unknown) {
  const code = (err as { code?: string; cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code;
  return code === "23503";
}
