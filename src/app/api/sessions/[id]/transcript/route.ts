import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { inngest, transcriptReady } from "@/inngest/client";
import { checkAuth, parseBody } from "@/lib/api";

const { sessions, transcriptSegments } = schema;

const body = z.object({
  endedAt: z.iso.datetime({ offset: true }).optional(),
  segments: z
    .array(
      z.object({
        speaker: z.enum(["student", "tutor", "other"]),
        text: z.string().min(1),
        startMs: z.number().int().nonnegative().optional(),
        endMs: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(2000),
});

/** Uploads a diarized transcript and queues extraction. Replaces segments until the session is processed. */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/transcript">) {
  const denied = checkAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;

  const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (session.status === "processed" || session.status === "processing") {
    return NextResponse.json({ error: `session already ${session.status}` }, { status: 409 });
  }

  await db.transaction(async (tx) => {
    await tx.delete(transcriptSegments).where(eq(transcriptSegments.sessionId, id));
    await tx.insert(transcriptSegments).values(
      parsed.data.segments.map((s, idx) => ({
        sessionId: id,
        idx,
        speaker: s.speaker,
        text: s.text,
        startMs: s.startMs ?? null,
        endMs: s.endMs ?? null,
      })),
    );
    await tx
      .update(sessions)
      .set({
        status: "open",
        endedAt: parsed.data.endedAt ? new Date(parsed.data.endedAt) : (session.endedAt ?? new Date()),
      })
      .where(eq(sessions.id, id));
  });

  await inngest.send(transcriptReady.create({ sessionId: id, learnerId: session.learnerId }));
  return NextResponse.json({ sessionId: id, segments: parsed.data.segments.length, queued: true }, { status: 202 });
}
