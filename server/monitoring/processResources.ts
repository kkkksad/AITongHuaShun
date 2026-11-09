import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import type { ProcessResourceSnapshot } from "../../shared/systemMonitoring";

export interface ProcessResourceReading {
  observedAt: string;
  monotonicMs: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
  eventLoopIdleMs: number;
  eventLoopActiveMs: number;
  memory: ProcessResourceSnapshot["memory"];
}
interface DelaySampler {
  readonly count: number;
  enable(): unknown;
  disable(): unknown;
  reset(): void;
  percentile(percentile: number): number;
}
interface ProcessResourceOptions {
  read: () => ProcessResourceReading;
  createHistogram: () => DelaySampler;
}

function readProcess(): ProcessResourceReading {
  const cpu = process.cpuUsage();
  const loop = performance.eventLoopUtilization();
  const memory = process.memoryUsage();
  return {
    observedAt: new Date().toISOString(), monotonicMs: performance.now(),
    cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system,
    eventLoopIdleMs: loop.idle, eventLoopActiveMs: loop.active,
    memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external, arrayBuffersBytes: memory.arrayBuffers },
  };
}

/** Process-wide measurements; each app owns its sampling window and bounded histogram. */
export class ProcessResourceMonitor {
  private baseline: ProcessResourceReading | null = null;
  private interval: ProcessResourceSnapshot["interval"] = null;
  private histogram: DelaySampler | null = null;
  private closed = false;
  private readonly options: ProcessResourceOptions;

  constructor(options: Partial<ProcessResourceOptions> = {}) {
    this.options = {
      read: options.read ?? readProcess,
      createHistogram: options.createHistogram ?? (() => monitorEventLoopDelay({ resolution: 20 })),
    };
  }

  snapshot(): ProcessResourceSnapshot {
    if (this.closed) throw new Error("Process resource monitor is closed");
    const current = this.options.read();
    if (!this.baseline) {
      this.histogram = this.options.createHistogram();
      this.histogram.enable();
      this.baseline = current;
    } else {
      const durationMs = current.monotonicMs - this.baseline.monotonicMs;
      if (durationMs >= 1000) {
        const user = current.cpuUserMicros - this.baseline.cpuUserMicros;
        const system = current.cpuSystemMicros - this.baseline.cpuSystemMicros;
        const active = current.eventLoopActiveMs - this.baseline.eventLoopActiveMs;
        const idle = current.eventLoopIdleMs - this.baseline.eventLoopIdleMs;
        const validCpu = [durationMs, user, system].every(value => Number.isFinite(value) && value >= 0);
        const validLoop = [active, idle].every(value => Number.isFinite(value) && value >= 0) && active + idle > 0;
        const delayNs = this.histogram!.count > 0 ? this.histogram!.percentile(95) : null;
        this.interval = validCpu ? {
          startedAt: this.baseline.observedAt, endedAt: current.observedAt, durationMs,
          cpuPercentOfOneCore: (user + system) / (durationMs * 1000) * 100,
          eventLoopUtilization: validLoop ? active / (active + idle) : null,
          eventLoopDelayP95Ms: delayNs !== null && Number.isFinite(delayNs) && delayNs >= 0 ? delayNs / 1_000_000 : null,
        } : null;
        this.baseline = current;
        this.histogram!.reset();
      }
    }
    return { scope: "api-process", observedAt: current.observedAt, memory: { ...current.memory },
      interval: this.interval ? { ...this.interval } : null };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.histogram?.disable();
    this.histogram = null;
    this.baseline = null;
    this.interval = null;
  }
}
