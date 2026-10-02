import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/api";
import { getSnapshot } from "@/lib/snapshot";

export async function GET(req: Request, ctx: RouteContext<"/api/learners/[id]/snapshot">) {
  const denied = checkAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const snapshot = await getSnapshot(id);
  if (!snapshot) return NextResponse.json({ error: "learner not found" }, { status: 404 });
  return NextResponse.json(snapshot);
}
