// The verdict rule: the page's signature element (mockups v6/v7). A categorical
// scale — refuted → not enough evidence → conflicting/cherrypicking → supported
// — with a pin marking where THIS verdict sits. Label always co-rendered with
// colour (SIT-R9: verdict never by colour alone). Not a smiley meter: the four
// stops are categories, not degrees.

import type { VerdictClass } from "@/lib/verdict-page";

const STOPS: Array<{ cls: VerdictClass; label: string; color: string }> = [
  { cls: "refuted", label: "Refuted", color: "var(--v-ref)" },
  { cls: "not_enough_evidence", label: "Not enough evidence", color: "var(--v-nei)" },
  { cls: "conflicting_cherry_picking", label: "Accurate but incomplete", color: "var(--v-inc)" },
  { cls: "supported", label: "Supported", color: "var(--v-sup)" },
];

export function VerdictRule({ verdictClass }: { verdictClass: VerdictClass }) {
  const position = STOPS.findIndex((s) => s.cls === verdictClass);
  const stop = STOPS[position];
  return (
    <div>
      <div
        aria-hidden="true"
        className="relative h-[3px] rounded-sm"
        style={{
          background: `linear-gradient(90deg, var(--v-ref) 0%, var(--v-ref) 22%, var(--v-nei) 22%, var(--v-nei) 40%, var(--v-inc) 40%, var(--v-inc) 72%, var(--v-sup) 72%, var(--v-sup) 100%)`,
        }}
      >
        <span
          className="absolute top-[-9px] h-5 w-5 rounded-full border-4 border-white bg-white shadow-md"
          style={{
            left: `${(position + 0.5) * 25}%`,
            borderColor: stop?.color,
            transform: "translateX(-50%)",
          }}
          role="img"
          aria-label={`Verdict: ${stop?.label}`}
        />
      </div>
      <div className="mt-2 flex justify-between text-[11.5px] font-semibold text-[#9b7a45]">
        {STOPS.map((s) => (
          <span
            key={s.cls}
            className={s.cls === verdictClass ? "font-extrabold text-[#8a5a12]" : undefined}
          >
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
