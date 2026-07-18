import * as fs from "node:fs";
import * as path from "node:path";

const MB = 1024 * 1024;

export interface RuntimeLogPolicy {
  logDir: string;
  retentionDays: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  activeFileGraceMs: number;
}

export interface RuntimeLogCleanupOptions extends RuntimeLogPolicy {
  workspaceRoot: string;
  nowMs?: number;
  dryRun?: boolean;
}

export interface RuntimeLogCleanupResult {
  scannedFiles: number;
  deletedFiles: string[];
  skippedActiveFiles: string[];
  bytesBefore: number;
  bytesAfter: number;
  warnings: string[];
  dryRun: boolean;
}

interface RuntimeLogFile {
  name: string;
  path: string;
  sizeBytes: number;
  mtimeMs: number;
}

function parsePositiveNumber(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

export function parseRuntimeLogPolicy(
  environment: NodeJS.ProcessEnv,
  workspaceRoot = process.cwd(),
): RuntimeLogPolicy {
  const retentionDays = parsePositiveNumber(
    environment.RUNTIME_LOG_RETENTION_DAYS,
    7,
    "RUNTIME_LOG_RETENTION_DAYS",
  );
  const maxTotalMb = parsePositiveNumber(
    environment.RUNTIME_LOG_MAX_TOTAL_MB,
    100,
    "RUNTIME_LOG_MAX_TOTAL_MB",
  );
  const maxFileMb = parsePositiveNumber(
    environment.RUNTIME_LOG_MAX_FILE_MB,
    20,
    "RUNTIME_LOG_MAX_FILE_MB",
  );

  return {
    logDir: path.resolve(workspaceRoot, environment.RUNTIME_LOG_DIR ?? "logs"),
    retentionDays,
    maxTotalBytes: Math.floor(maxTotalMb * MB),
    maxFileBytes: Math.floor(maxFileMb * MB),
    activeFileGraceMs: 5 * 60 * 1_000,
  };
}

function assertInsideWorkspace(workspaceRoot: string, target: string): void {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Runtime log directory must be inside the workspace");
  }
}

export function cleanupRuntimeLogs(
  options: RuntimeLogCleanupOptions,
): RuntimeLogCleanupResult {
  assertInsideWorkspace(options.workspaceRoot, options.logDir);
  const nowMs = options.nowMs ?? Date.now();
  const dryRun = options.dryRun ?? false;
  const warnings: string[] = [];
  const deletedFiles: string[] = [];
  const skippedActiveFiles: string[] = [];
  const removed = new Set<string>();

  if (!fs.existsSync(options.logDir)) {
    return {
      scannedFiles: 0,
      deletedFiles,
      skippedActiveFiles,
      bytesBefore: 0,
      bytesAfter: 0,
      warnings,
      dryRun,
    };
  }

  const files: RuntimeLogFile[] = [];
  for (const entry of fs.readdirSync(options.logDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".log")) continue;
    const filePath = path.resolve(options.logDir, entry.name);
    const relative = path.relative(path.resolve(options.logDir), filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try {
      const stats = fs.statSync(filePath);
      files.push({
        name: entry.name,
        path: filePath,
        sizeBytes: stats.size,
        mtimeMs: stats.mtimeMs,
      });
    } catch (error) {
      warnings.push(`${entry.name}: ${error instanceof Error ? error.message : "stat failed"}`);
    }
  }

  files.sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name));
  const bytesBefore = files.reduce((total, file) => total + file.sizeBytes, 0);
  let bytesAfter = bytesBefore;

  const removeFile = (file: RuntimeLogFile): boolean => {
    if (removed.has(file.path)) return true;
    if (nowMs - file.mtimeMs < options.activeFileGraceMs) {
      if (!skippedActiveFiles.includes(file.name)) skippedActiveFiles.push(file.name);
      return false;
    }
    try {
      if (!dryRun) fs.unlinkSync(file.path);
      removed.add(file.path);
      deletedFiles.push(file.name);
      bytesAfter -= file.sizeBytes;
      return true;
    } catch (error) {
      warnings.push(`${file.name}: ${error instanceof Error ? error.message : "delete failed"}`);
      return false;
    }
  };

  const retentionMs = options.retentionDays * 24 * 60 * 60 * 1_000;
  for (const file of files) {
    if (nowMs - file.mtimeMs > retentionMs) removeFile(file);
  }

  for (const file of files) {
    if (!removed.has(file.path) && file.sizeBytes > options.maxFileBytes) {
      removeFile(file);
    }
  }

  for (const file of files) {
    if (bytesAfter <= options.maxTotalBytes) break;
    if (!removed.has(file.path)) removeFile(file);
  }

  if (bytesAfter > options.maxTotalBytes) {
    warnings.push("Active or locked log files keep the directory above its configured budget");
  }

  return {
    scannedFiles: files.length,
    deletedFiles,
    skippedActiveFiles,
    bytesBefore,
    bytesAfter,
    warnings,
    dryRun,
  };
}
