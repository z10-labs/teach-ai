import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { checkAuth, parseBody } from "@/lib/api";

const { sessions, learners } = schema;

const body = z.object({
  learnerId: z.uuid(),
  tutorName: z.string().optional(),
  kind: z.enum(["live_tutor", "ai_tutor", "self_study"]).default("live_tutor"),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }).optional(),
});

export async function POST(req: Request) {
  const denied = checkAuth(req);
  if (denied) return denied;
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;

  const [learner] = await db.select({ id: learners.id }).from(learners).where(eq(learners.id, d.learnerId));
  if (!learner) return NextResponse.json({ error: "unknown learner" }, { status: 422 });

  const [session] = await db
    .insert(sessions)
    .values({
      learnerId: d.learnerId,
      tutorName: d.tutorName ?? null,
      kind: d.kind,
      startedAt: new Date(d.startedAt),
      endedAt: d.endedAt ? new Date(d.endedAt) : null,
    })
    .returning({ id: sessions.id });
  return NextResponse.json(session, { status: 201 });
}
