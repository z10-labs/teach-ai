import Link from "next/link";
import { listLearners } from "@/lib/learner-view";

export default async function Home() {
  const learners = await listLearners();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Learners</h1>
        <p className="mt-1 text-sm text-stone-600">
          Each learner&apos;s memory is built from platform events and session transcripts.
        </p>
      </div>

      {learners.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-600">
          No learners yet. Run <code className="font-mono">pnpm db:seed</code> to create the demo learner.
        </p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {learners.map((l) => (
            <li key={l.id}>
              <Link href={`/learners/${l.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-stone-50">
                <span className="font-medium">{l.displayName}</span>
                <span className="text-sm text-stone-500">
                  {[l.gradeLevel, l.curriculum].filter(Boolean).join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
