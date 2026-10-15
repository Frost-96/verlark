/** External generation only; practice validates all results and owns persistence. */
export interface ExpressionFeedback {
  readonly mode: "development" | "unavailable" | "bailian";
  /** Called only after practice has validated and persisted a successful result. */
  acceptResult?(requestId: string): Promise<void>;
  generate(input: {
    text: string;
    context?: { learnerId: string; contentVersionId: string };
    confirmationId: string;
    requestId: string;
    rulesVersion: string;
  }): Promise<unknown>;
}
