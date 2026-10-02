import { NextResponse } from "next/server";
import { z } from "zod";
import { inngest, memoryChanged } from "@/inngest/client";
import { checkAuth, parseBody } from "@/lib/api";
import { rebuildSnapshot } from "@/lib/snapshot";
import { applyTutorAction } from "@/lib/tutor-actions";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), tutorId: z.string().min(1) }),
  z.object({ action: z.literal("dismiss"), tutorId: z.string().min(1) }),
  z.object({ action: z.literal("edit"), tutorId: z.string().min(1), statement: z.string().min(1).max(500) }),
]);

export async function PATCH(req: Request, ctx: RouteContext<"/api/memories/[id]">) {
  const denied = checkAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;

  const learnerId = await applyTutorAction(id, parsed.data);
  if (!learnerId) return NextResponse.json({ error: "memory not found" }, { status: 404 });
  await rebuildSnapshot(learnerId);
  await inngest.send(memoryChanged.create({ learnerId, reason: `tutor:${parsed.data.action}` }));
  return NextResponse.json({ ok: true });
}
