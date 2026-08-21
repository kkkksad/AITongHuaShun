import { lazy } from "react";

export const CHUNK_RECOVERY_SESSION_KEY = "kairos:chunk-recovery-url";

type RecoveryStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : String(error);
}

export function isChunkLoadError(error: unknown): boolean {
  return /ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|Unable to preload CSS|vite:preloadError/i.test(
    errorMessage(error),
  );
}

export function shouldAttemptChunkRecovery(
  storage: RecoveryStorage,
  pageKey: string,
): boolean {
  try {
    return storage.getItem(CHUNK_RECOVERY_SESSION_KEY) !== pageKey;
  } catch {
    return false;
  }
}

export function markChunkRecoveryAttempt(
  storage: RecoveryStorage,
  pageKey: string,
): void {
  try {
    storage.setItem(CHUNK_RECOVERY_SESSION_KEY, pageKey);
  } catch {
    // A blocked sessionStorage must not prevent the error boundary from rendering.
  }
}

export function clearChunkRecoveryAttempt(storage: RecoveryStorage): void {
  try {
    storage.removeItem(CHUNK_RECOVERY_SESSION_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function recoverFromChunkLoadError(input: {
  error: unknown;
  storage: RecoveryStorage;
  pageKey: string;
  reload: () => void;
}): boolean {
  if (
    !isChunkLoadError(input.error) ||
    !shouldAttemptChunkRecovery(input.storage, input.pageKey)
  ) {
    return false;
  }
  markChunkRecoveryAttempt(input.storage, input.pageKey);
  input.reload();
  return true;
}

export function lazyWithChunkRecovery(importer: () => Promise<{ default: any }>): any {
  return lazy(async () => {
    try {
      return await importer();
    } catch (error) {
      if (typeof window !== "undefined") {
        recoverFromChunkLoadError({
          error,
          storage: window.sessionStorage,
          pageKey: window.location.href,
          reload: () => window.location.reload(),
        });
      }
      throw error;
    }
  });
}
