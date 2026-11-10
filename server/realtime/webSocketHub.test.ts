import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketHub } from "./webSocketHub";
import type { TradingEvent } from "../../shared/trading";

class Socket extends EventEmitter {
  readyState = 1;
  send = vi.fn<(payload: string) => void>();
  ping = vi.fn();
  terminate = vi.fn(() => { this.readyState = 3; this.emit("close"); });
}
const event: TradingEvent = { type: "system.status", data: { connected: true, message: "test" } };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-10T07:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("WebSocket client transport fault isolation", () => {
  it("continues broadcasting to healthy clients after another socket send throws", () => {
    const hub = new WebSocketHub(), broken = new Socket(), healthy = new Socket();
    broken.send.mockImplementation(() => { throw Error("client transport unavailable"); });
    hub.add(broken); hub.add(healthy);
    expect(() => hub.broadcast(event)).not.toThrow();
    expect(JSON.parse(healthy.send.mock.calls[0][0])).toEqual(event);
    expect(broken.terminate).toHaveBeenCalledOnce();
    expect(hub.connectionCount).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    hub.broadcast(event);
    expect(healthy.send).toHaveBeenCalledTimes(2);
    expect(broken.send).toHaveBeenCalledOnce();
  });

  it("isolates an initial direct send failure even if terminating that connection also throws", () => {
    const hub = new WebSocketHub(), socket = new Socket();
    socket.send.mockImplementation(() => { throw Error("write failed"); });
    socket.terminate.mockImplementation(() => { throw Error("cleanup failed"); });
    hub.add(socket);
    expect(() => hub.send(socket, event)).not.toThrow();
    expect(hub.connectionCount).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let a heartbeat transport error escape its timer or stop another connection", () => {
    const hub = new WebSocketHub(), broken = new Socket(), healthy = new Socket();
    broken.ping.mockImplementation(() => { throw Error("ping failed"); });
    hub.add(broken); hub.add(healthy);
    expect(() => vi.advanceTimersByTime(30_000)).not.toThrow();
    expect(healthy.ping).toHaveBeenCalledOnce();
    expect(hub.connectionCount).toBe(1); expect(vi.getTimerCount()).toBe(1);
  });

  it("cleans every stale connection even if one termination throws", () => {
    const hub = new WebSocketHub(), broken = new Socket(), healthy = new Socket();
    broken.terminate.mockImplementation(() => { throw Error("terminate failed"); });
    hub.add(broken); hub.add(healthy); vi.setSystemTime(Date.now() + 90_000);
    let pruned: number | undefined;
    expect(() => { pruned = hub.pruneStale(); }).not.toThrow();
    expect(pruned).toBe(2);
    expect(hub.connectionCount).toBe(0); expect(vi.getTimerCount()).toBe(0);
    expect(healthy.terminate).toHaveBeenCalledOnce();
  });

  it("makes duplicate registration harmless and keeps one heartbeat until close", () => {
    const hub = new WebSocketHub(), socket = new Socket();
    hub.add(socket); hub.add(socket);
    expect(vi.getTimerCount()).toBe(1);
    expect(socket.listenerCount("close")).toBe(1);
    socket.emit("close");
    expect(hub.connectionCount).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  it("actually expires an unresponsive peer at 90 seconds without an external prune caller", () => {
    const hub = new WebSocketHub(), socket = new Socket(); hub.add(socket);
    vi.advanceTimersByTime(89_999); expect(hub.connectionCount).toBe(1);
    vi.advanceTimersByTime(1);
    expect(hub.connectionCount).toBe(0); expect(vi.getTimerCount()).toBe(0);
    expect(socket.terminate).toHaveBeenCalledOnce();
  });

  it("preserves pong liveness and removes cleanly on error without later pings", () => {
    const hub = new WebSocketHub(), socket = new Socket(); hub.add(socket);
    vi.advanceTimersByTime(60_000); socket.emit("pong"); vi.advanceTimersByTime(40_000);
    expect(hub.isAlive(socket)).toBe(true); expect(hub.pruneStale()).toBe(0);
    const pings = socket.ping.mock.calls.length; socket.emit("error", Error("transport closed"));
    vi.advanceTimersByTime(60_000);
    expect(hub.connectionCount).toBe(0); expect(socket.ping).toHaveBeenCalledTimes(pings);
  });

  it("continues surfacing server serialization errors instead of treating them as client failures", () => {
    const hub = new WebSocketHub(), socket = new Socket(); hub.add(socket);
    const circular = { ...event } as TradingEvent & { circular?: unknown }; circular.circular = circular;
    expect(() => hub.broadcast(circular)).toThrow();
    expect(hub.connectionCount).toBe(1); expect(socket.terminate).not.toHaveBeenCalled();
  });
});
