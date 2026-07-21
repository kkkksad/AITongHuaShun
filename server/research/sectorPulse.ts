export type SectorPulseSourceStatus =
  | "live-read-only"
  | "degraded"
  | "mock-disabled";

export type SectorPulseEvent =
  | "technology-pullback"
  | "leader-pullback";

export interface SectorPulseSignal {
  event: SectorPulseEvent;
  sectorName: string;
  peakChangePercent: number;
  previousChangePercent: number;
  currentChangePercent: number;
  pullbackPercentPoints: number;
  observedAt: string;
}

export interface SectorPulseObservation {
  tradingDate: string;
  observedAt: string;
  sourceStatus: SectorPulseSourceStatus;
  sectors: Array<{
    name: string;
    changePercent: number;
  }>;
}

interface SectorPulseState {
  peakChangePercent: number;
  previousChangePercent: number;
  alerted: boolean;
}

interface SectorPulseTrackerOptions {
  maxSectors?: number;
  technologyMinimumPeak?: number;
  technologyPullback?: number;
  technologyStepPullback?: number;
  leaderMinimumPeak?: number;
  leaderPullback?: number;
}

const TECHNOLOGY_SECTOR_PATTERN =
  /半导体|芯片|电子|元件|计算机|软件|通信|互联网|人工智能|AI|光学光电子|自动化设备/i;

function round(value: number): number {
  return Number(value.toFixed(2));
}

export function isTechnologySector(name: string): boolean {
  return TECHNOLOGY_SECTOR_PATTERN.test(name.trim());
}

export class SectorPulseTracker {
  private readonly maxSectors: number;
  private readonly technologyMinimumPeak: number;
  private readonly technologyPullback: number;
  private readonly technologyStepPullback: number;
  private readonly leaderMinimumPeak: number;
  private readonly leaderPullback: number;
  private tradingDate: string | null = null;
  private readonly states = new Map<string, SectorPulseState>();

  constructor(options: SectorPulseTrackerOptions = {}) {
    this.maxSectors = Math.max(1, Math.min(options.maxSectors ?? 24, 80));
    this.technologyMinimumPeak = options.technologyMinimumPeak ?? 2;
    this.technologyPullback = options.technologyPullback ?? 1.5;
    this.technologyStepPullback = options.technologyStepPullback ?? 1;
    this.leaderMinimumPeak = options.leaderMinimumPeak ?? 4;
    this.leaderPullback = options.leaderPullback ?? 2;
  }

  observe(input: SectorPulseObservation): SectorPulseSignal[] {
    if (input.sourceStatus !== "live-read-only") return [];
    if (input.tradingDate !== this.tradingDate) {
      this.tradingDate = input.tradingDate;
      this.states.clear();
    }

    const signals: SectorPulseSignal[] = [];
    const validSectors = input.sectors
      .filter((sector) => (
        sector.name.trim().length > 0 && Number.isFinite(sector.changePercent)
      ))
      .slice(0, this.maxSectors);

    for (const sector of validSectors) {
      const name = sector.name.trim();
      const current = round(sector.changePercent);
      const previousState = this.states.get(name);
      if (!previousState) {
        if (this.states.size < this.maxSectors) {
          this.states.set(name, {
            peakChangePercent: current,
            previousChangePercent: current,
            alerted: false,
          });
        }
        continue;
      }

      const peak = Math.max(previousState.peakChangePercent, current);
      const pullback = round(peak - current);
      const stepPullback = round(previousState.previousChangePercent - current);
      const technology = isTechnologySector(name);
      const qualifies = technology
        ? peak >= this.technologyMinimumPeak && (
          pullback >= this.technologyPullback ||
          stepPullback >= this.technologyStepPullback
        )
        : peak >= this.leaderMinimumPeak && pullback >= this.leaderPullback;

      if (qualifies && !previousState.alerted) {
        signals.push({
          event: technology ? "technology-pullback" : "leader-pullback",
          sectorName: name,
          peakChangePercent: round(peak),
          previousChangePercent: round(previousState.previousChangePercent),
          currentChangePercent: current,
          pullbackPercentPoints: pullback,
          observedAt: input.observedAt,
        });
      }

      this.states.set(name, {
        peakChangePercent: peak,
        previousChangePercent: current,
        alerted: previousState.alerted || qualifies,
      });
    }

    return signals;
  }

  getTrackedCount(): number {
    return this.states.size;
  }
}
