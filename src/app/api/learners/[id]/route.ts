import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { checkAuth } from "@/lib/api";

/** Right-to-erasure: cascades through events, sessions, transcripts, memories, embeddings and snapshot. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/learners/[id]">) {
  const denied = checkAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const deleted = await db.delete(schema.learners).where(eq(schema.learners.id, id)).returning({ id: schema.learners.id });
  if (deleted.length === 0) return NextResponse.json({ error: "learner not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
