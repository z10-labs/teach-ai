"use client";

import { useActionState } from "react";
import { recallAction, type RecallState } from "./actions";

export function RecallBox({ learnerId }: { learnerId: string }) {
  const [state, action, pending] = useActionState(recallAction.bind(null, learnerId), {
    query: "",
    hits: [],
  } satisfies RecallState);

  return (
    <div className="space-y-3">
      <form action={action} className="flex gap-2">
        <input
          name="query"
          defaultValue={state.query}
          placeholder="e.g. what helped with ratios?"
          className="flex-1 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-emerald-600"
        />
        <button
          disabled={pending}
          className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Searching…" : "Recall"}
        </button>
      </form>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state.hits.length > 0 && (
        <ul className="space-y-2">
          {state.hits.map((h) => (
            <li key={h.id} className="rounded-md border border-stone-200 bg-white p-2 text-sm">
              <div className="flex justify-between text-xs text-stone-500">
                <span>
                  {h.type} · {h.kind}
                </span>
                <span>score {h.score.toFixed(2)}</span>
              </div>
              <p className="mt-1">{h.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
