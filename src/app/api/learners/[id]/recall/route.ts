import { NextResponse } from "next/server";
import { z } from "zod";
import { checkAuth, parseBody } from "@/lib/api";
import { recall } from "@/lib/recall";

const body = z.object({ query: z.string().min(1).max(1000), k: z.number().int().min(1).max(50).default(8) });

export async function POST(req: Request, ctx: RouteContext<"/api/learners/[id]/recall">) {
  const denied = checkAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const parsed = await parseBody(req, body);
  if ("error" in parsed) return parsed.error;
  if (!process.env.AI_GATEWAY_API_KEY) {
    return NextResponse.json({ error: "recall requires AI_GATEWAY_API_KEY" }, { status: 503 });
  }
  return NextResponse.json({ hits: await recall(id, parsed.data.query, parsed.data.k) });
}
