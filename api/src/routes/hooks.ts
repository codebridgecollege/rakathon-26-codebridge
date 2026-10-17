// Named hooks for Step 5 (AI recording): purge a case's recording when it is closed, run the speaker pass after an
// approval, purge at the end of a session. No-ops until then, so Step 5 adds behaviour without touching the routes.
export const hooks = {
  async onCaseClosed(_caseId: string): Promise<void> {},
  async onApproved(_caseId: string, _decisionId: string): Promise<void> {},
  async onSessionEnded(_day: string): Promise<void> {},
};
