import type { AuthChangeEvent } from "@supabase/supabase-js";

export function shouldReloadCatalogOnAuthEvent(event: AuthChangeEvent): boolean {
  switch (event) {
    case "SIGNED_IN":
    case "SIGNED_OUT":
      return true;
    case "INITIAL_SESSION":
    case "TOKEN_REFRESHED":
    case "USER_UPDATED":
    case "PASSWORD_RECOVERY":
    case "MFA_CHALLENGE_VERIFIED":
      return false;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export function shouldApplyAuthSessionEvent(event: AuthChangeEvent): boolean {
  switch (event) {
    case "INITIAL_SESSION":
    case "SIGNED_IN":
    case "SIGNED_OUT":
    case "USER_UPDATED":
      return true;
    case "TOKEN_REFRESHED":
    case "PASSWORD_RECOVERY":
    case "MFA_CHALLENGE_VERIFIED":
      return false;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export function shouldClearSessionForUserChange(
  previousUserId: string | null,
  nextUserId: string | null
): boolean {
  if (nextUserId === null) {
    return previousUserId !== null;
  }
  return previousUserId !== null && previousUserId !== nextUserId;
}
