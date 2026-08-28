/**
 * Process-wide guard for the deliberately exceptional paired demo experiment.
 * Normal trading has a one-contract invariant; this guard prevents it from
 * interleaving while a feasibility run owns the private trading connection.
 */
let activeExecutionId: string | null = null;

export function claimArbExecution(id: string): boolean {
  if (activeExecutionId) return false;
  activeExecutionId = id;
  return true;
}

export function releaseArbExecution(id: string): void {
  if (activeExecutionId === id) activeExecutionId = null;
}

export function activeArbExecutionId(): string | null {
  return activeExecutionId;
}

export function isArbExecutionActive(): boolean {
  return activeExecutionId !== null;
}
