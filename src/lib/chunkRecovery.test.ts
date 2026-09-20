import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  CHUNK_RECOVERY_SESSION_KEY,
  clearChunkRecoveryAttempt,
  getChunkRecoveryStorage,
  isChunkLoadError,
  recoverFromChunkLoadError,
  shouldAttemptChunkRecovery,
} from "./chunkRecovery";

function storage(): Storage {
  return {
    getItem: (key) => key === CHUNK_RECOVERY_SESSION_KEY ? null : null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  };
}

describe("chunk recovery", () => {
  it("recognizes Vite dynamic import and preload failures", () => {
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/Market.js"))).toBe(true);
    expect(isChunkLoadError(new Error("request failed"))).toBe(false);
  });

  it("allows one reload for a page and suppresses a reload loop", () => {
    const values = new Map<string, string>();
    const session = {
      ...storage(),
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const reload = () => undefined;

    expect(shouldAttemptChunkRecovery(session, "/market")).toBe(true);
    expect(recoverFromChunkLoadError({
      error: new Error("ChunkLoadError: loading chunk 12 failed"),
      storage: session,
      pageKey: "/market",
      reload,
    })).toBe(true);
    expect(shouldAttemptChunkRecovery(session, "/market")).toBe(false);
    expect(recoverFromChunkLoadError({
      error: new Error("ChunkLoadError: loading chunk 12 failed"),
      storage: session,
      pageKey: "/market",
      reload,
    })).toBe(false);
    clearChunkRecoveryAttempt(session);
    expect(shouldAttemptChunkRecovery(session, "/market")).toBe(true);
  });

  it("falls back when sessionStorage access is blocked", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("storage blocked");
      },
    });
    try {
      const blockedStorage = getChunkRecoveryStorage();
      expect(shouldAttemptChunkRecovery(blockedStorage, "/blocked-storage")).toBe(true);
      const reload = vi.fn();
      expect(recoverFromChunkLoadError({
        error: new Error("ChunkLoadError: loading chunk 12 failed"),
        storage: blockedStorage,
        pageKey: "/blocked-storage",
        reload,
      })).toBe(true);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(shouldAttemptChunkRecovery(blockedStorage, "/blocked-storage")).toBe(false);
      clearChunkRecoveryAttempt(blockedStorage);
    } finally {
      if (descriptor) {
        Object.defineProperty(window, "sessionStorage", descriptor);
      }
    }
  });
});
