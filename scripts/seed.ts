import { config } from "dotenv";

config({ path: ".env.local" });

export const DEMO_LEARNER_ID = "00000000-0000-4000-8000-000000000001";

const SKILLS = [
  { id: "math", name: "Mathematics", subject: "math", parentId: null, prerequisites: [] },
  { id: "math.fractions", name: "Fractions", subject: "math", parentId: "math", prerequisites: [] },
  {
    id: "math.fractions.add_unlike",
    name: "Add fractions with unlike denominators",
    subject: "math",
    parentId: "math.fractions",
    prerequisites: [],
  },
  { id: "math.ratio", name: "Ratios", subject: "math", parentId: "math", prerequisites: ["math.fractions"] },
  {
    id: "math.ratio.part_whole",
    name: "Part-to-part vs part-to-whole ratios",
    subject: "math",
    parentId: "math.ratio",
    prerequisites: ["math.fractions"],
  },
  {
    id: "math.ratio.word_problems",
    name: "Set up ratio word problems",
    subject: "math",
    parentId: "math.ratio",
    prerequisites: ["math.ratio.part_whole"],
  },
];

const MISCONCEPTIONS = [
  {
    id: "frac.add_denominators",
    skillId: "math.fractions.add_unlike",
    description: "Adds denominators together when adding fractions (1/2 + 1/3 = 2/5)",
  },
  {
    id: "ratio.part_part_vs_whole",
    skillId: "math.ratio.part_whole",
    description: "Treats a part-to-part ratio as part-to-whole (3:2 read as 3/2 of the total)",
  },
  {
    id: "ratio.order_swapped",
    skillId: "math.ratio.word_problems",
    description: "Writes ratio terms in the wrong order relative to the question",
  },
];

async function main() {
  const { db, schema } = await import("../src/db");
  const { sql } = await import("drizzle-orm");

  await db
    .insert(schema.skills)
    .values(SKILLS)
    .onConflictDoUpdate({
      target: schema.skills.id,
      set: { name: sql`excluded.name`, parentId: sql`excluded.parent_id`, prerequisites: sql`excluded.prerequisites` },
    });
  await db
    .insert(schema.misconceptions)
    .values(MISCONCEPTIONS)
    .onConflictDoUpdate({ target: schema.misconceptions.id, set: { description: sql`excluded.description` } });
  await db
    .insert(schema.learners)
    .values({
      id: DEMO_LEARNER_ID,
      displayName: "Thandi M.",
      gradeLevel: "Grade 10",
      curriculum: "CAPS",
      guardianConsentAt: new Date(),
    })
    .onConflictDoNothing();

  console.log(`Seeded ${SKILLS.length} skills, ${MISCONCEPTIONS.length} misconceptions, learner ${DEMO_LEARNER_ID}`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
