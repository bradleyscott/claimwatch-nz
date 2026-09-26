// The role → schema registry the live adapter routes against (CROSS-CUTTING §2).

import type { z } from "zod";
import { CitationOutput } from "./citation.ts";
import { NliCheckOutput } from "./nli.ts";
import { AuthorityClassifyOutput, OpenWebOutput } from "./open-web.ts";
import { QuoteFidelityOutput } from "./quote.ts";
import { MaterialityOutput } from "./stat-grid.ts";

export const VERIFICATION_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "grid-materiality": MaterialityOutput,
  "citation-compare": CitationOutput,
  "quote-fidelity": QuoteFidelityOutput,
  "nli-audit": NliCheckOutput,
  "open-web": OpenWebOutput,
  "authority-classify": AuthorityClassifyOutput,
};
