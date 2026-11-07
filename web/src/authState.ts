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
 * The pasture room is derived from a confirmed identity, never from a
 * transient refresh. A login switches to the private room; a confirmed logout
 * switches back; anything else keeps the room already joined so the iframe is
 * not remounted (which would spawn a second Ranger connection).
 */
export function nextPastureRoom(previous: string | null, loginId: string | null, status: PlayerAuthStatus): string | null {
  if (loginId) return 'main';
  if (status === 'signed-out') return null;
  return previous;
}

/**
 * Multiple-tab policy: one authenticated Ranger presence per account. The
 * newest connection takes it over and the older socket is closed, so two tabs
 * can never control the same Ranger at once and no duplicate Ranger is left
 * standing.
 */
export const MULTI_TAB_POLICY = 'newest-connection-wins' as const;
export const MULTI_TAB_POLICY_NOTE = 'Opening the pasture in another tab moves your Ranger there; the older tab disconnects.';
