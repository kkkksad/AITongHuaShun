import { describe, expect, it } from "vitest";
import {
  createEsotericMarketReading,
  formatLocalDate,
  getEsotericMethodLabel,
} from "./esotericMarket";

describe("esotericMarket", () => {
  it("generates a reproducible reading for the same date and target", () => {
    const input = { date: "2026-08-08", target: "600519", method: "yijing" as const };
    expect(createEsotericMarketReading(input)).toEqual(createEsotericMarketReading(input));
  });

  it("keeps the reading within the bounded cultural reference set", () => {
    const reading = createEsotericMarketReading({
      date: "2026-08-08",
      target: "今日大盘",
      method: "wuxing",
    });

    expect(reading.hexagram.number).toBeGreaterThanOrEqual(1);
    expect(reading.hexagram.number).toBeLessThanOrEqual(64);
    expect(reading.changingLine).toBeGreaterThanOrEqual(1);
    expect(reading.changingLine).toBeLessThanOrEqual(6);
    expect(reading.risk).toContain("不得据此");
    expect(reading.target).toBe("今日大盘");
  });

  it("changes the deterministic draw when the round changes", () => {
    const first = createEsotericMarketReading({ date: "2026-08-08", target: "半导体" });
    const second = createEsotericMarketReading({ date: "2026-08-08", target: "半导体", round: 1 });

    expect(second.seed).not.toBe(first.seed);
  });

  it("formats local dates without UTC shifting", () => {
    expect(formatLocalDate(new Date(2026, 7, 8, 23, 59))).toBe("2026-08-08");
    expect(getEsotericMethodLabel("number")).toBe("数字起卦");
  });
});
