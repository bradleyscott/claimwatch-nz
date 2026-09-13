// The verdict rule: the page's signature element (SITE-MVP §2.3, mockups v6/v7
// `.vrule`/`.vpin`/`.vlabels`). A BAND + PIN over four CATEGORIES — refuted →
// not enough evidence → accurate but incomplete → supported — with the pin
// resting on the segment that holds THIS verdict and every stop label
// co-rendered as text so the verdict never rides on colour alone (SIT-R9).
//
// Not a degree meter (ADR-0004): the four stops are discrete categories, so the
// band is four flat segments with hard edges — never a blended gradient — and
// the pin marks a category, never a position on a continuum.

import { cn } from "@/lib/utils";
import { VERDICT_LABELS, type VerdictClass } from "@/lib/verdict-page";

/**
 * The band's geometry, left → right: where each category starts and ends on the
 * 100%-wide track, and the CSS variable that colours it (mockup `.vrule`).
 *
 * Segment widths are deliberately UNEQUAL — the categories are not degrees
 * (ADR-0004), so the track is not cut into equal intervals.
 *
 * The colours are CSS variable references rather than Tailwind classes because
 * the same value drives both the segment fill and the pin's ring; the variables
 * live in `globals.css` `:root` and are resolved by the browser at paint time.
 */
const BAND: readonly {
  cls: VerdictClass;
  /** Segment start on the track, percent. */
  from: number;
  /** Segment end on the track, percent. */
  to: number;
  /** Mark colour: the segment's fill and the pin's ring. */
  colour: string;
}[] = [
  { cls: "refuted", from: 0, to: 22, colour: "var(--verdict-refuted)" },
  { cls: "not_enough_evidence", from: 22, to: 40, colour: "var(--verdict-unverified)" },
  { cls: "conflicting_cherry_picking", from: 40, to: 72, colour: "var(--verdict-incomplete)" },
  { cls: "supported", from: 72, to: 100, colour: "var(--verdict-supported)" },
];

/** Render order of the four classes, left to right — the band's own order. */
export const VERDICT_ORDER: readonly VerdictClass[] = BAND.map((segment) => segment.cls);

/**
 * Hard edges: each segment repeats its colour at both of its stops, so the
 * gradient has no blend region and no segment bleeds into its neighbour.
 */
const BAND_BACKGROUND = `linear-gradient(90deg, ${BAND.flatMap((segment) => [
  `${segment.colour} ${segment.from}%`,
  `${segment.colour} ${segment.to}%`,
]).join(", ")})`;

/**
 * One presentational treatment per verdict class. Every value is a complete
 * Tailwind class string over the `--verdict-*` tokens — keep them literal so
 * the Tailwind scanner can see them (no runtime class-name concatenation).
 */
export const VERDICT_TONES: Record<
  VerdictClass,
  {
    /** Soft card surface + hairline for the verdict card. */
    surface: string;
    /** Text-safe ink for the verdict word and the band's current stop label. */
    ink: string;
    /** Chip treatment for feed cards and inline verdict labels. */
    chip: string;
  }
> = {
  refuted: {
    surface: "border-verdict-refuted-line bg-verdict-refuted-soft",
    ink: "text-verdict-refuted-ink",
    chip: "border-verdict-refuted-line bg-verdict-refuted-soft text-verdict-refuted-ink",
  },
  not_enough_evidence: {
    surface: "border-verdict-unverified-line bg-verdict-unverified-soft",
    ink: "text-verdict-unverified-ink",
    chip: "border-verdict-unverified-line bg-verdict-unverified-soft text-verdict-unverified-ink",
  },
  conflicting_cherry_picking: {
    surface: "border-verdict-incomplete-line bg-verdict-incomplete-soft",
    ink: "text-verdict-incomplete-ink",
    chip: "border-verdict-incomplete-line bg-verdict-incomplete-soft text-verdict-incomplete-ink",
  },
  supported: {
    surface: "border-verdict-supported-line bg-verdict-supported-soft",
    ink: "text-verdict-supported-ink",
    chip: "border-verdict-supported-line bg-verdict-supported-soft text-verdict-supported-ink",
  },
};

export function VerdictRule({ verdictClass }: { verdictClass: VerdictClass }) {
  const here = BAND.find((segment) => segment.cls === verdictClass);
  return (
    <div>
      <div
        aria-hidden="true"
        className="relative h-[3px] rounded-sm"
        style={{ background: BAND_BACKGROUND }}
      >
        {here ? (
          // Pin centred on ITS OWN segment (mockups: "pin centred inside the
          // 'incomplete' segment (40%–72% → mid ≈ 56%)"), so it always sits on
          // the verdict's colour and never straddles a boundary.
          <span
            className="absolute top-[-9px] size-5 -translate-x-1/2 rounded-full border-4 bg-card shadow-md"
            style={{ left: `${(here.from + here.to) / 2}%`, borderColor: here.colour }}
          />
        ) : null}
      </div>
      {/*
        The legend IS the accessible verdict: the band above is decorative, so
        every stop is named in text and the live stop is marked `aria-current`.
        The muted labels use `--muted-foreground` (comfortably above 4.5:1 on
        every verdict surface) rather than the mockup's `#9b7a45`, which lands
        at ~3.8:1 at this size — the accessibility rule (SIT-R9) wins over the
        swatch. Wraps rather than overflowing on narrow viewports.
      */}
      <ol
        aria-label="Verdict class"
        className="mt-2.5 flex flex-wrap justify-between gap-x-3 gap-y-1 text-[11.5px] leading-tight font-semibold text-muted-foreground"
      >
        {BAND.map((segment) => {
          const current = segment.cls === verdictClass;
          return (
            <li
              key={segment.cls}
              aria-current={current ? "true" : undefined}
              className={current ? cn("font-extrabold", VERDICT_TONES[segment.cls].ink) : undefined}
            >
              {VERDICT_LABELS[segment.cls].plainLabel}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
