// The tool-loop agent boundary (ADR-0026): a second contract beside `LlmPort`,
// for a role that must plan, call tools, read results and decide the next step.
//
// It exists because the AI SDK's `generateText` already provides exactly what a
// research agent needs: a bounded tool loop (`stopWhen`), per-step tool-call
// detail for audit (`result.steps`, `onStepEnd`, `onToolExecutionEnd`), and
// parallel tool execution. This port keeps that behind a typed, mockable
// boundary so the blind rule and L1 mocking hold.

import type { z } from "zod";

export interface AgentToolSpec {
  description: string;
  inputSchema: z.ZodTypeAny;
  /** Absent means calling this tool ends the loop (the model signals completion). */
  execute?: (input: unknown) => Promise<unknown>;
}

export interface AgentCall {
  role: string;
  system: string;
  prompt: string;
  tools: Record<string, AgentToolSpec>;
  /** Hard cap on model steps. */
  maxSteps: number;
  /** Calling this tool ends the loop; it must have no `execute`. */
  stopTool: string;
}

export interface AgentToolCall {
  toolName: string;
  input: unknown;
}

export interface AgentToolResult {
  toolName: string;
  output: unknown;
}

export interface AgentStepRecord {
  stepNumber: number;
  toolCalls: AgentToolCall[];
  toolResults: AgentToolResult[];
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export type AgentCallResult =
  | {
      ok: true;
      steps: AgentStepRecord[];
      usage: { tokensIn: number; tokensOut: number };
      model: string;
      /** How the model was served (ADR-0011 rule 3). */
      servingMode?: string;
      finishReason?: string;
    }
  | {
      ok: false;
      failureClass: "schema-validation" | "llm-refusal" | "timeout";
      rawOutput?: string;
      model?: string;
      finishReason?: string;
    };

export interface AgentPort {
  runAgent(call: AgentCall): Promise<AgentCallResult>;
}
