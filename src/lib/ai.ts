import { embed, embedMany, generateText, Output } from "ai";
import { z } from "zod";

export const EXTRACTOR_VERSION = "extractor:v1";

const extractionModel = () => process.env.EXTRACTION_MODEL ?? "openai/gpt-5-mini";
const embeddingModel = () => process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small";

export const STRENGTH_WEIGHT = { weak: 0.3, moderate: 0.5, strong: 0.7 } as const;

export const extractionSchema = z.object({
  summary: z.string().describe("3-5 sentence factual summary of the session for the learner's history"),
  skillsCovered: z.array(z.string()).describe("Skill ids from the catalog that were worked on"),
  claims: z.array(
    z.object({
      kind: z.enum(["misconception", "strategy_works", "strategy_fails", "goal", "preference", "behavior", "context"]),
      skillId: z.string().nullable().describe("Skill id from the catalog, or null"),
      misconceptionId: z.string().nullable().describe("Misconception id from the catalog when it clearly matches, else null"),
      statement: z.string().describe("One sentence, present tense, about observable learning behaviour"),
      relation: z
        .enum(["supports", "contradicts"])
        .describe("'contradicts' only when the session shows an existing memory no longer holds"),
      existingMemoryId: z.string().nullable().describe("Id of the existing memory this refers to, or null if new"),
      strength: z.enum(["weak", "moderate", "strong"]),
      deadline: z.string().nullable().describe("ISO date for goals with a deadline, else null"),
      evidence: z
        .array(z.object({ segmentIdx: z.number().int(), quote: z.string() }))
        .min(1)
        .describe("Transcript segments that support this claim, with a short verbatim quote"),
    }),
  ),
  commitments: z.array(
    z.object({
      owner: z.enum(["student", "tutor", "parent"]),
      description: z.string(),
      skillId: z.string().nullable(),
      dueInDays: z.number().int().nullable(),
    }),
  ),
  affect: z.string().nullable().describe("Brief note on engagement/emotional arc, or null"),
});

export type Extraction = z.infer<typeof extractionSchema>;

export type ExtractionContext = {
  skills: { id: string; name: string }[];
  misconceptions: { id: string; skillId: string; description: string }[];
  existingMemories: { id: string; kind: string; skillId: string | null; statement: string }[];
  segments: { idx: number; speaker: string; text: string }[];
};

const SYSTEM = `You maintain a learner model for a tutoring platform. You read one tutoring session transcript and extract durable, evidence-backed observations about the STUDENT.

Rules:
- Only record what the transcript shows. Every claim must cite transcript segments.
- Distinguish student speech from tutor speech. A tutor explaining a common mistake is NOT evidence the student has it.
- Describe observable learning behaviour only. Never infer medical, psychological or learning-disability diagnoses, family circumstances, or other sensitive traits.
- Prefer catalog skill and misconception ids. Use null rather than inventing ids.
- If an existing memory is reinforced, set existingMemoryId and relation "supports". If the session shows it no longer holds (e.g. the student now does it correctly and explains why), use "contradicts".
- strategy_works / strategy_fails: teaching approaches the tutor used and how the student responded.
- Skip one-off trivia. Fewer, well-supported claims beat many weak ones.
- Commitments: concrete things someone agreed to do before a future session.`;

export async function extractFromTranscript(ctx: ExtractionContext): Promise<Extraction> {
  const prompt = [
    "## Skill catalog",
    ...ctx.skills.map((s) => `- ${s.id}: ${s.name}`),
    "",
    "## Misconception catalog",
    ...ctx.misconceptions.map((m) => `- ${m.id} (skill ${m.skillId}): ${m.description}`),
    "",
    "## Existing memories about this student",
    ...(ctx.existingMemories.length
      ? ctx.existingMemories.map((m) => `- [${m.id}] ${m.kind}${m.skillId ? ` (${m.skillId})` : ""}: ${m.statement}`)
      : ["(none)"]),
    "",
    "## Transcript",
    ...ctx.segments.map((s) => `[${s.idx}] ${s.speaker.toUpperCase()}: ${s.text}`),
  ].join("\n");

  const { output } = await generateText({
    model: extractionModel(),
    system: SYSTEM,
    prompt,
    output: Output.object({ schema: extractionSchema }),
  });
  return output;
}

export async function embedTexts(values: string[]): Promise<number[][]> {
  if (values.length === 0) return [];
  const { embeddings } = await embedMany({ model: embeddingModel(), values });
  return embeddings;
}

export async function embedText(value: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel(), value });
  return embedding;
}
