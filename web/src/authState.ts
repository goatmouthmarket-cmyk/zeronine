import { isTransientFailure, isVerifiedAuthFailure } from './http.ts';

/** How the browser currently regards the authenticated Deriv player session. */
export type PlayerAuthStatus = 'idle' | 'live' | 'reconnecting' | 'signed-out';

export type PlayerStateFailure = {
  status: PlayerAuthStatus;
  /** Only a confirmed rejection may clear the last verified session. */
  clearSession: boolean;
  message: string;
};

export const PLAYER_RECONNECTING_MESSAGE = 'Account temporarily unavailable. Reconnecting…';
export const PLAYER_REFRESH_RETRY_MESSAGE = 'Account could not be refreshed. Retrying…';

/**
 * Decide what a failed player-state request means. A 503, a timeout or a
 * dropped connection keeps the last verified session and shows reconnecting;
 * only a 401 clears it.
 */
export function classifyPlayerStateFailure(error: unknown): PlayerStateFailure {
  if (isVerifiedAuthFailure(error)) return { status: 'signed-out', clearSession: true, message: 'Signed out' };
  if (isTransientFailure(error)) return { status: 'reconnecting', clearSession: false, message: PLAYER_RECONNECTING_MESSAGE };
  return { status: 'reconnecting', clearSession: false, message: PLAYER_REFRESH_RETRY_MESSAGE };
}

/**
 * All players use the shared pasture room. Identity and trading permissions
 * are resolved separately, so login changes do not remount the Ranger.
 */
export function nextPastureRoom(_previous: string | null, _loginId: string | null, _status: PlayerAuthStatus): string {
  // Guests and Deriv-connected players share one pasture; trading permissions
  // remain enforced separately by authenticated trading APIs.
  return 'main';
}

/**
 * Multiple-tab policy: one authenticated Ranger presence per account. The
 * newest connection takes it over and the older socket is closed, so two tabs
 * can never control the same Ranger at once and no duplicate Ranger is left
 * standing.
 */
export const MULTI_TAB_POLICY = 'newest-connection-wins' as const;
export const MULTI_TAB_POLICY_NOTE = 'Opening the pasture in another tab moves your Ranger there; the older tab disconnects.';
