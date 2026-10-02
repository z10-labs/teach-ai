import { eventType, Inngest } from "inngest";
import { z } from "zod";

export const inngest = new Inngest({
  id: "teach-ai",
  checkpointing: { maxRuntime: "45s" },
});

export const eventRecorded = eventType("teach/event.recorded", {
  schema: z.object({ eventId: z.uuid(), learnerId: z.uuid() }),
});

export const transcriptReady = eventType("teach/transcript.ready", {
  schema: z.object({ sessionId: z.uuid(), learnerId: z.uuid() }),
});

export const memoryChanged = eventType("teach/memory.changed", {
  schema: z.object({ learnerId: z.uuid(), reason: z.string() }),
});
