/** External generation only; practice validates all results and owns persistence. */
export interface ExpressionFeedback {
  readonly mode: "development" | "unavailable";
  generate(input: {
    text: string;
    confirmationId: string;
    requestId: string;
    rulesVersion: string;
  }): Promise<unknown>;
}
