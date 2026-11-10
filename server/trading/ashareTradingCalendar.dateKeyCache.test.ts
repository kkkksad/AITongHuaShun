import { afterEach, describe, expect, it, vi } from "vitest";

async function freshDateKey() {
  vi.resetModules();
  return (await import("./ashareTradingCalendar")).getChinaDateKey;
}
const reference = (value: Date) => new Date(value.getTime() + 28_800_000).toISOString().slice(0, 10);

afterEach(() => vi.restoreAllMocks());

describe("Beijing date key bounded reuse", () => {
  it("formats once for repeated readings within the same Beijing date", async () => {
    const dateKey = await freshDateKey();
    const format = vi.spyOn(Date.prototype, "toISOString");
    const midnight = Date.parse("2026-11-10T00:00:00+08:00");
    for (let index = 0; index < 100; index++) {
      expect(dateKey(new Date(midnight + index * 800_000))).toBe("2026-11-10");
    }
    expect(format).toHaveBeenCalledTimes(1);
  });

  it("changes exactly at Beijing midnight and can move backward", async () => {
    const dateKey = await freshDateKey();
    const midnight = Date.parse("2026-11-11T00:00:00+08:00");
    const format = vi.spyOn(Date.prototype, "toISOString");
    expect([-1, 0, 1, -1, 0].map(offset => dateKey(new Date(midnight + offset))))
      .toEqual(["2026-11-10", "2026-11-11", "2026-11-11", "2026-11-10", "2026-11-11"]);
    expect(format).toHaveBeenCalledTimes(4);
  });

  it("uses the value of a mutated Date and shares equivalent offset representations", async () => {
    const dateKey = await freshDateKey(), mutable = new Date("2026-11-10T12:00:00+08:00");
    const format = vi.spyOn(Date.prototype, "toISOString");
    expect(dateKey(mutable)).toBe("2026-11-10");
    expect(dateKey(new Date("2026-11-09T23:00:00-05:00"))).toBe("2026-11-10");
    mutable.setTime(Date.parse("2026-11-11T00:00:00+08:00"));
    expect(dateKey(mutable)).toBe("2026-11-11");
    mutable.setTime(Date.parse("2026-11-09T23:59:59+08:00"));
    expect(dateKey(mutable)).toBe("2026-11-09");
    expect(format).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["2000-02-28T16:00:00Z", "2000-02-29"],
    ["2024-02-29T16:00:00Z", "2024-03-01"],
    ["2026-12-31T16:00:00Z", "2027-01-01"],
    ["1969-12-31T15:59:59.999Z", "1969-12-31"],
    ["1969-12-31T16:00:00Z", "1970-01-01"],
    ["0000-02-28T16:00:00Z", "0000-02-29"],
  ])("preserves the UTC+8 date of %s", async (iso, expected) => {
    const dateKey = await freshDateKey(), value = new Date(iso);
    expect(dateKey(value)).toBe(expected);
    expect(dateKey(value)).toBe(expected);
  });

  it("still rejects invalid dates after the cache is populated", async () => {
    const dateKey = await freshDateKey(), mutable = new Date("2026-11-10T12:00:00+08:00");
    expect(dateKey(mutable)).toBe("2026-11-10");
    mutable.setTime(NaN);
    expect(() => dateKey(mutable)).toThrow(RangeError);
    expect(() => dateKey(new Date(Infinity))).toThrow(RangeError);
    expect(dateKey(new Date("2026-11-10T23:00:00+08:00"))).toBe("2026-11-10");
  });

  it("does not hide shifted Date overflow in the same cached day", async () => {
    const dateKey = await freshDateKey(), edge = 8_640_000_000_000_000 - 28_800_000;
    const lastRepresentable = new Date(edge);
    expect(dateKey(lastRepresentable)).toBe(reference(lastRepresentable));
    expect(() => dateKey(new Date(edge + 1))).toThrow(RangeError);
    expect(() => dateKey(new Date(8_640_000_000_000_000))).toThrow(RangeError);
    expect(dateKey(lastRepresentable)).toBe(reference(lastRepresentable));
  });

  it("matches the original formatting across deterministic scattered and extreme dates", async () => {
    const dateKey = await freshDateKey();
    const times = [-8_640_000_000_000_000, -62_167_219_200_000, -1, 0, 1,
      253_402_300_799_999, 8_640_000_000_000_000 - 28_800_000];
    for (let index = 0; index < 5_000; index++) times.push((index * 8_947_231_719) % 12_000_000_000_000 - 6_000_000_000_000);
    for (const time of times) {
      const value = new Date(time);
      expect(dateKey(value)).toBe(reference(value));
    }
  });
});
