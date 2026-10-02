import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

/** Returns an error response when TEACH_AI_API_KEY is set and the bearer token doesn't match. */
export function checkAuth(req: Request): NextResponse | null {
  const key = process.env.TEACH_AI_API_KEY;
  if (!key) return null;
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(token);
  const b = Buffer.from(key);
  if (a.length === b.length && timingSafeEqual(a, b)) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<{ data: z.output<T> } | { error: NextResponse }> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { error: NextResponse.json({ error: "invalid JSON body" }, { status: 400 }) };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { error: NextResponse.json({ error: "validation failed", issues: z.treeifyError(parsed.error) }, { status: 422 }) };
  }
  return { data: parsed.data };
}
