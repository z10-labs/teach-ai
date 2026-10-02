import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { loadLearnerView, type LearnerView } from "@/lib/learner-view";
import { editMemory, refreshSnapshot, tutorAction } from "./actions";
import { RecallBox } from "./recall-box";

export default async function LearnerPage({ params }: PageProps<"/learners/[id]">) {
  const { id } = await params;
  const view = await loadLearnerView(id);
  if (!view) notFound();
  const { learner, snapshot } = view;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-stone-500 hover:text-stone-800">
            ← Learners
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{learner.displayName}</h1>
          <p className="text-sm text-stone-600">
            {[learner.gradeLevel, learner.curriculum].filter(Boolean).join(" · ")}
          </p>
        </div>
        <form action={refreshSnapshot.bind(null, learner.id)} className="text-right text-xs text-stone-500">
          <p>Snapshot as of {snapshot ? fmt(snapshot.asOf) : "—"}</p>
          <button className="mt-1 rounded border border-stone-300 bg-white px-2 py-1 hover:bg-stone-100">Rebuild</button>
        </form>
      </div>

      {snapshot && <SnapshotPanel snapshot={snapshot} />}

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <section className="space-y-3">
          <SectionTitle hint="Interpreted claims, each backed by evidence">Memories</SectionTitle>
          <MemoryList memories={view.memories} />
        </section>

        <aside className="space-y-8">
          <section className="space-y-3">
            <SectionTitle hint="Bayesian knowledge tracing from answers">Skill mastery</SectionTitle>
            <SkillTable states={view.skillStates} />
          </section>
          <section className="space-y-3">
            <SectionTitle hint="Semantic search over memories and sessions">Recall</SectionTitle>
            <RecallBox learnerId={learner.id} />
          </section>
          <section className="space-y-3">
            <SectionTitle>Commitments</SectionTitle>
            <CommitmentList commitments={view.commitments} />
          </section>
          <section className="space-y-3">
            <SectionTitle>Sessions</SectionTitle>
            <SessionList sessions={view.sessions} episodes={view.episodes} />
          </section>
        </aside>
      </div>

      <details className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer font-medium">Raw snapshot JSON (what an AI tutor receives)</summary>
        <pre className="mt-3 overflow-x-auto font-mono text-xs">{JSON.stringify(snapshot, null, 2)}</pre>
      </details>
    </div>
  );
}

function SnapshotPanel({ snapshot: s }: { snapshot: NonNullable<LearnerView["snapshot"]> }) {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <Card title="Goals">
        <Bullets items={s.goals.map((g) => (g.deadline ? `${g.text} (by ${g.deadline})` : g.text))} />
      </Card>
      <Card title="Focus skills">
        {s.focusSkills.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-2">
            {s.focusSkills.map((f) => (
              <li key={f.skillId}>
                <div className="flex justify-between text-sm">
                  <span>{f.name}</span>
                  <span className="text-stone-500">
                    {Math.round(f.mastery * 100)}% {trendArrow(f.trend)}
                  </span>
                </div>
                <Bar value={f.mastery} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Active misconceptions">
        <Bullets
          items={s.activeMisconceptions.map(
            (m) => `${m.statement} · ${Math.round(m.confidence * 100)}%${m.verified ? " · verified" : ""}`,
          )}
        />
      </Card>
      <Card title="What works">
        <Bullets items={s.whatWorks} />
      </Card>
      <Card title="What doesn't">
        <Bullets items={s.whatDoesnt} />
      </Card>
      <Card title="Behaviour & context">
        <Bullets items={[...s.behavior, ...s.preferences, ...s.context]} />
      </Card>
      <Card title="Open commitments">
        <Bullets items={s.openCommitments.map((c) => `${c.owner}: ${c.text}${c.dueAt ? ` (due ${fmtDate(c.dueAt)})` : ""}`)} />
      </Card>
      <Card title="Last session">
        {s.lastSession ? <p className="text-sm text-stone-700">{s.lastSession.summary}</p> : <Empty />}
      </Card>
      <Card title="Recently resolved">
        <Bullets items={s.recentlyResolved.map((r) => r.statement)} />
      </Card>
    </section>
  );
}

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  proposed: "bg-amber-100 text-amber-800",
  resolved: "bg-sky-100 text-sky-800",
  superseded: "bg-stone-200 text-stone-600",
  dismissed: "bg-stone-200 text-stone-600",
  expired: "bg-stone-200 text-stone-600",
};

function MemoryList({ memories }: { memories: LearnerView["memories"] }) {
  if (memories.length === 0) return <Empty text="No memories yet. Send events or a session transcript." />;
  const order = ["active", "proposed", "resolved", "expired", "dismissed", "superseded"];
  const sorted = [...memories].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  return (
    <ul className="space-y-3">
      {sorted.map((m) => {
        const live = m.status === "active" || m.status === "proposed";
        return (
          <li key={m.id} className={`rounded-lg border border-stone-200 bg-white p-4 ${live ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS_STYLE[m.status]}`}>{m.status}</span>
              <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-700">{m.kind.replace("_", " ")}</span>
              {m.skillId && <span className="font-mono text-stone-500">{m.skillId}</span>}
              {m.verifiedByTutor && <span className="text-emerald-700">✓ tutor verified</span>}
              <span className="ml-auto text-stone-500">
                confidence {Math.round(m.confidence * 100)}% · {m.createdBy}
              </span>
            </div>
            <p className="mt-2">{m.statement}</p>
            <div className="mt-1 h-1 w-full rounded bg-stone-100">
              <div className="h-1 rounded bg-emerald-600" style={{ width: `${Math.round(m.confidence * 100)}%` }} />
            </div>

            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-stone-600">Evidence ({m.evidence.length})</summary>
              <ul className="mt-2 space-y-1.5">
                {m.evidence.map(({ e, segmentText, speaker, eventType, eventPayload }) => (
                  <li key={`${e.sourceType}:${e.sourceId}`} className="flex gap-2 text-xs">
                    <span
                      className={`shrink-0 rounded px-1 ${e.relation === "supports" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}
                    >
                      {e.relation === "supports" ? "+" : "−"}
                      {e.weight.toFixed(2)}
                    </span>
                    <span className="shrink-0 text-stone-500">{e.sourceType}</span>
                    <span className="text-stone-700">
                      {e.quote
                        ? `“${e.quote}”`
                        : segmentText
                          ? `${speaker}: ${segmentText}`
                          : e.sourceType === "tutor"
                            ? `verified by ${e.sourceId}`
                            : eventType
                              ? describeEvent(eventType, eventPayload ?? {})
                              : <span className="font-mono">{e.sourceId.slice(0, 8)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </details>

            {live && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {!m.verifiedByTutor && (
                  <form action={tutorAction.bind(null, m.id, "verify")}>
                    <button className="rounded border border-emerald-300 px-2 py-1 text-emerald-800 hover:bg-emerald-50">
                      Verify
                    </button>
                  </form>
                )}
                <form action={tutorAction.bind(null, m.id, "dismiss")}>
                  <button className="rounded border border-stone-300 px-2 py-1 text-stone-700 hover:bg-stone-100">
                    Dismiss
                  </button>
                </form>
                <form action={editMemory.bind(null, m.id)} className="flex flex-1 gap-1">
                  <input
                    name="statement"
                    placeholder="Correct the wording…"
                    className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-1"
                  />
                  <button className="rounded border border-stone-300 px-2 py-1 hover:bg-stone-100">Save</button>
                </form>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SkillTable({ states }: { states: LearnerView["skillStates"] }) {
  if (states.length === 0) return <Empty text="No answers recorded yet." />;
  return (
    <ul className="space-y-2 rounded-lg border border-stone-200 bg-white p-3">
      {states.map(({ s, name }) => (
        <li key={s.skillId} className="text-sm">
          <div className="flex justify-between">
            <span>{name}</span>
            <span className="text-stone-500">
              {Math.round(s.mastery * 100)}% {trendArrow(s.trend)}
            </span>
          </div>
          <Bar value={s.mastery} />
          <p className="mt-0.5 text-xs text-stone-500">
            {s.attempts} attempts · review {s.nextReviewAt ? fmtDate(s.nextReviewAt.toISOString()) : "—"}
          </p>
        </li>
      ))}
    </ul>
  );
}

function CommitmentList({ commitments }: { commitments: LearnerView["commitments"] }) {
  if (commitments.length === 0) return <Empty />;
  return (
    <ul className="space-y-2 text-sm">
      {commitments.map((c) => (
        <li key={c.id} className="rounded-md border border-stone-200 bg-white p-2">
          <div className="flex justify-between text-xs text-stone-500">
            <span>{c.owner}</span>
            <span className={c.status === "done" ? "text-emerald-700" : c.status === "missed" ? "text-red-700" : ""}>
              {c.status}
            </span>
          </div>
          <p>{c.description}</p>
        </li>
      ))}
    </ul>
  );
}

function SessionList({ sessions, episodes }: { sessions: LearnerView["sessions"]; episodes: LearnerView["episodes"] }) {
  if (sessions.length === 0) return <Empty />;
  return (
    <ul className="space-y-2 text-sm">
      {sessions.map((s) => {
        const ep = episodes.find((e) => e.sessionId === s.id);
        return (
          <li key={s.id} className="rounded-md border border-stone-200 bg-white p-2">
            <div className="flex justify-between text-xs text-stone-500">
              <span>
                {fmt(s.startedAt.toISOString())} · {s.tutorName ?? s.kind}
              </span>
              <span>{s.status}</span>
            </div>
            {ep && <p className="mt-1 text-stone-700">{ep.summary}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div>
      <h2 className="font-semibold">{children}</h2>
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">{title}</h3>
      {children}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return <Empty />;
  return (
    <ul className="list-disc space-y-1 pl-4 text-sm text-stone-700">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

function Bar({ value }: { value: number }) {
  const color = value < 0.6 ? "bg-amber-500" : value < 0.8 ? "bg-lime-500" : "bg-emerald-600";
  return (
    <div className="mt-1 h-1.5 w-full rounded bg-stone-100">
      <div className={`h-1.5 rounded ${color}`} style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function Empty({ text = "Nothing yet." }: { text?: string }) {
  return <p className="text-sm text-stone-400">{text}</p>;
}

function describeEvent(type: string, p: Record<string, unknown>) {
  if (type === "question.answered") {
    const verdict = p.correct ? (Number(p.hintsUsed) > 0 ? "correct with hints" : "correct") : "wrong";
    return `${verdict} on ${p.questionId}${p.chosenOption ? ` (chose ${p.chosenOption})` : ""}`;
  }
  return type;
}

const trendArrow = (t: string) => (t === "up" ? "↑" : t === "down" ? "↓" : "→");
const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { dateStyle: "medium" });
