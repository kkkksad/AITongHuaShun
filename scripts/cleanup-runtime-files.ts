import { config as loadEnv } from "dotenv";
import {
  cleanupRuntimeLogs,
  parseRuntimeLogPolicy,
} from "../server/operations/runtimeFileRetention";

loadEnv({ path: ".env.local", override: false });
loadEnv({ path: ".env", override: false });

const workspaceRoot = process.cwd();
const dryRun = process.argv.includes("--dry-run");

try {
  const policy = parseRuntimeLogPolicy(process.env, workspaceRoot);
  const result = cleanupRuntimeLogs({
    workspaceRoot,
    ...policy,
    dryRun,
  });
  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
  const action = dryRun ? "would remove" : "removed";
  console.log(
    `[runtime-cleanup] scanned ${result.scannedFiles} logs, ${action} ${result.deletedFiles.length}, ${mb(result.bytesBefore)} MB -> ${mb(result.bytesAfter)} MB`,
  );
  for (const warning of result.warnings) {
    console.warn(`[runtime-cleanup] ${warning}`);
  }
} catch (error) {
  console.warn(
    `[runtime-cleanup] skipped: ${error instanceof Error ? error.message : "unknown error"}`,
  );
}
