type Account = { loginid: string; mode: string } | null | undefined;

/** This preference applies only to an explicitly confirmed real account. */
export function maySkipCowReview(remembered: string | null, requested: Account, current: Account, quoteMode: string): boolean {
  return Boolean(remembered && requested?.mode === 'real' && current?.mode === 'real'
    && requested.loginid === remembered && current.loginid === remembered && quoteMode === 'real');
}
