"use server";

import { revalidatePath } from "next/cache";
import { inngest, memoryChanged } from "@/inngest/client";
import { recall, type RecallHit } from "@/lib/recall";
import { rebuildSnapshot } from "@/lib/snapshot";
import { applyTutorAction } from "@/lib/tutor-actions";

const DEMO_TUTOR = "demo-tutor";

export async function tutorAction(memoryId: string, action: "verify" | "dismiss") {
  const learnerId = await applyTutorAction(memoryId, { action, tutorId: DEMO_TUTOR });
  if (!learnerId) return;
  await rebuildSnapshot(learnerId);
  await inngest.send(memoryChanged.create({ learnerId, reason: `tutor:${action}` }));
  revalidatePath(`/learners/${learnerId}`);
}

export async function editMemory(memoryId: string, formData: FormData) {
  const statement = String(formData.get("statement") ?? "").trim();
  if (!statement) return;
  const learnerId = await applyTutorAction(memoryId, { action: "edit", tutorId: DEMO_TUTOR, statement });
  if (!learnerId) return;
  await rebuildSnapshot(learnerId);
  await inngest.send(memoryChanged.create({ learnerId, reason: "tutor:edit" }));
  revalidatePath(`/learners/${learnerId}`);
}

export async function refreshSnapshot(learnerId: string) {
  await rebuildSnapshot(learnerId);
  revalidatePath(`/learners/${learnerId}`);
}

export type RecallState = { query: string; hits: RecallHit[]; error?: string };

export async function recallAction(learnerId: string, _prev: RecallState, formData: FormData): Promise<RecallState> {
  const query = String(formData.get("query") ?? "").trim();
  if (!query) return { query, hits: [] };
  if (!process.env.AI_GATEWAY_API_KEY) return { query, hits: [], error: "Recall needs AI_GATEWAY_API_KEY." };
  try {
    return { query, hits: await recall(learnerId, query) };
  } catch (err) {
    return { query, hits: [], error: err instanceof Error ? err.message : "Recall failed" };
  }
}
