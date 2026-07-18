import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupRuntimeLogs,
  parseRuntimeLogPolicy,
} from "./runtimeFileRetention";

const tempDirs: string[] = [];

function tempWorkspace(): { root: string; logs: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kairos-retention-"));
  const logs = path.join(root, "logs");
  fs.mkdirSync(logs);
  tempDirs.push(root);
  return { root, logs };
}

function writeSizedFile(filePath: string, sizeBytes: number, mtimeMs: number) {
  fs.writeFileSync(filePath, Buffer.alloc(sizeBytes, "x"));
  const modifiedAt = new Date(mtimeMs);
  fs.utimesSync(filePath, modifiedAt, modifiedAt);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("cleanupRuntimeLogs", () => {
  it("removes expired logs without touching non-log state files", () => {
    const { root, logs } = tempWorkspace();
    const nowMs = Date.UTC(2026, 6, 18, 12);
    const oldLog = path.join(logs, "old.log");
    const stateFile = path.join(logs, "paper-trading-state.json");
    writeSizedFile(oldLog, 12, nowMs - 8 * 24 * 60 * 60 * 1_000);
    writeSizedFile(stateFile, 12, nowMs - 30 * 24 * 60 * 60 * 1_000);

    const result = cleanupRuntimeLogs({
      workspaceRoot: root,
      logDir: logs,
      retentionDays: 7,
      maxFileBytes: 100,
      maxTotalBytes: 1_000,
      activeFileGraceMs: 5 * 60 * 1_000,
      nowMs,
    });

    expect(fs.existsSync(oldLog)).toBe(false);
    expect(fs.existsSync(stateFile)).toBe(true);
    expect(result.deletedFiles).toEqual(["old.log"]);
  });

  it("removes oversized inactive logs but protects recently written files", () => {
    const { root, logs } = tempWorkspace();
    const nowMs = Date.UTC(2026, 6, 18, 12);
    const inactive = path.join(logs, "inactive.log");
    const active = path.join(logs, "active.log");
    writeSizedFile(inactive, 101, nowMs - 10 * 60 * 1_000);
    writeSizedFile(active, 101, nowMs - 60 * 1_000);

    const result = cleanupRuntimeLogs({
      workspaceRoot: root,
      logDir: logs,
      retentionDays: 7,
      maxFileBytes: 100,
      maxTotalBytes: 1_000,
      activeFileGraceMs: 5 * 60 * 1_000,
      nowMs,
    });

    expect(fs.existsSync(inactive)).toBe(false);
    expect(fs.existsSync(active)).toBe(true);
    expect(result.skippedActiveFiles).toEqual(["active.log"]);
  });

  it("deletes oldest inactive logs until the directory is within budget", () => {
    const { root, logs } = tempWorkspace();
    const nowMs = Date.UTC(2026, 6, 18, 12);
    writeSizedFile(path.join(logs, "oldest.log"), 60, nowMs - 30 * 60 * 1_000);
    writeSizedFile(path.join(logs, "middle.log"), 60, nowMs - 20 * 60 * 1_000);
    writeSizedFile(path.join(logs, "newest.log"), 60, nowMs - 10 * 60 * 1_000);

    const result = cleanupRuntimeLogs({
      workspaceRoot: root,
      logDir: logs,
      retentionDays: 7,
      maxFileBytes: 100,
      maxTotalBytes: 120,
      activeFileGraceMs: 5 * 60 * 1_000,
      nowMs,
    });

    expect(result.deletedFiles).toEqual(["oldest.log"]);
    expect(result.bytesAfter).toBe(120);
    expect(fs.existsSync(path.join(logs, "newest.log"))).toBe(true);
  });

  it("reports a dry run without deleting files", () => {
    const { root, logs } = tempWorkspace();
    const nowMs = Date.UTC(2026, 6, 18, 12);
    const oldLog = path.join(logs, "old.log");
    writeSizedFile(oldLog, 12, nowMs - 8 * 24 * 60 * 60 * 1_000);

    const result = cleanupRuntimeLogs({
      workspaceRoot: root,
      logDir: logs,
      retentionDays: 7,
      maxFileBytes: 100,
      maxTotalBytes: 1_000,
      activeFileGraceMs: 5 * 60 * 1_000,
      nowMs,
      dryRun: true,
    });

    expect(result.deletedFiles).toEqual(["old.log"]);
    expect(result.bytesAfter).toBe(0);
    expect(fs.existsSync(oldLog)).toBe(true);
  });

  it("rejects a log directory outside the verified workspace", () => {
    const { root } = tempWorkspace();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "kairos-outside-"));
    tempDirs.push(outside);

    expect(() => cleanupRuntimeLogs({
      workspaceRoot: root,
      logDir: outside,
      retentionDays: 7,
      maxFileBytes: 100,
      maxTotalBytes: 1_000,
      activeFileGraceMs: 5 * 60 * 1_000,
    })).toThrow("inside the workspace");
  });
});

describe("parseRuntimeLogPolicy", () => {
  it("uses bounded defaults and accepts explicit megabyte budgets", () => {
    const root = path.resolve("workspace");

    expect(parseRuntimeLogPolicy({}, root)).toEqual({
      logDir: path.join(root, "logs"),
      retentionDays: 7,
      maxTotalBytes: 100 * 1024 * 1024,
      maxFileBytes: 20 * 1024 * 1024,
      activeFileGraceMs: 5 * 60 * 1_000,
    });

    expect(parseRuntimeLogPolicy({
      RUNTIME_LOG_RETENTION_DAYS: "3",
      RUNTIME_LOG_MAX_TOTAL_MB: "40",
      RUNTIME_LOG_MAX_FILE_MB: "8",
    }, root)).toMatchObject({
      retentionDays: 3,
      maxTotalBytes: 40 * 1024 * 1024,
      maxFileBytes: 8 * 1024 * 1024,
    });
  });
});
