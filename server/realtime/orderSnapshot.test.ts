import { once } from "node:events";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderRecord } from "../../shared/trading";
import { buildTradingApp } from "../app";
import { createTradingSystem } from "../system";
import { createTestConfig } from "../test/testConfig";

interface TestSocket { terminate(): void }

describe("WebSocket order snapshots", () => {
  const apps: FastifyInstance[] = [];
  const sockets: TestSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function createApp() {
    const config = createTestConfig({
      API_DOCS_ENABLED: false, RATE_LIMIT_MAX: 1_000,
      TRADING_SEED_PORTFOLIO: false,
    });
    const system = createTradingSystem(config);
    const app = await buildTradingApp({ config, system, startMarket: false });
    apps.push(app);
    await app.ready();
    return { app, system };
  }

  async function connect(app: FastifyInstance) {
    const messages: Array<{ type: string; data: unknown }> = [];
    const socket = await app.injectWS("/ws", {}, {
      onInit: (connection) => {
        connection.on("message", (data: unknown) => messages.push(JSON.parse(String(data))));
      },
    });
    sockets.push(socket);
    await new Promise<void>((resolve) => setImmediate(resolve));
    return { socket, messages };
  }

  function snapshot(messages: Array<{ type: string; data: unknown }>): OrderRecord[] {
    const snapshots = messages.filter((message) => message.type === "orders.snapshot");
    expect(snapshots).toHaveLength(1);
    return snapshots[0].data as OrderRecord[];
  }

  async function disconnect(app: FastifyInstance, socket: TestSocket) {
    const serverSocket = app.websocketServer.clients.values().next().value!;
    const closed = once(serverSocket, "close");
    socket.terminate();
    await closed;
  }

  it("includes an empty order snapshot in the initial handshake", async () => {
    const { app } = await createApp();
    const { messages } = await connect(app);

    expect(snapshot(messages)).toEqual([]);
    expect(messages.map((message) => message.type)).toEqual([
      "system.status", "market.snapshot", "account.snapshot", "positions.snapshot", "orders.snapshot",
    ]);
  });

  it.each(["market", "order"])("keeps %s processing and healthy clients working after a peer send fails", async trigger => {
    const { app, system } = await createApp();
    await connect(app);
    const bad = app.websocketServer.clients.values().next().value!;
    const healthy = await connect(app);
    vi.spyOn(bad, "send").mockImplementation(() => { throw Error("controlled client transport failure"); });
    const mark = vi.spyOn(system.broker, "markToMarket");
    if (trigger === "market") {
      expect(() => system.market.tick()).not.toThrow();
      expect(mark).toHaveBeenCalled();
    } else {
      expect(() => system.broker.submitOrder({ symbol: "601318", side: "buy", type: "market", quantity: 100 })).not.toThrow();
      expect(system.broker.getOrders()[0].status).toBe("filled");
    }
    await new Promise<void>(resolve => setImmediate(resolve));
    const type = trigger === "market" ? "market.snapshot" : "order.updated";
    expect(healthy.messages.filter(message => message.type === type).length).toBeGreaterThan(trigger === "market" ? 1 : 0);
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
  });

  it("sends the same newest 50 orders as the trading bootstrap REST request", async () => {
    const { app, system } = await createApp();
    for (let index = 0; index < 55; index++) {
      const order = system.broker.submitOrder({
        symbol: "600519", side: "buy", type: "limit", quantity: 100, limitPrice: 1,
        clientOrderId: `snapshot-order-${index}`,
      });
      expect(order.status).toBe("pending");
    }
    const expected = (await app.inject({ method: "GET", url: "/api/orders?limit=50" })).json<OrderRecord[]>();
    const { messages } = await connect(app);

    expect(snapshot(messages)).toEqual(expected);
    expect(snapshot(messages)).toHaveLength(50);
    expect(snapshot(messages)[0].clientOrderId).toBe("snapshot-order-54");
    expect(snapshot(messages)[49].clientOrderId).toBe("snapshot-order-5");
    expect(snapshot(messages)[0].name).toBe("贵州茅台");
  });

  it("resends actual filled, cancelled and newly created orders on reconnect", async () => {
    const { app, system } = await createApp();
    const fill = system.broker.submitOrder({
      symbol: "600519", side: "buy", type: "limit", quantity: 100, limitPrice: 1,
    });
    const cancel = system.broker.submitOrder({
      symbol: "600519", side: "buy", type: "limit", quantity: 100, limitPrice: 1,
    });
    const first = await connect(app);
    expect(snapshot(first.messages).map((order) => order.status)).toEqual(["pending", "pending"]);
    await disconnect(app, first.socket);

    system.broker.cancelOrder(cancel.id);
    const market = system.market.getSnapshot();
    system.broker.markToMarket({
      ...market,
      quotes: market.quotes.map((quote) => quote.symbol === fill.symbol ? { ...quote, price: 1 } : quote),
    });
    const added = system.broker.submitOrder({
      symbol: "601318", side: "buy", type: "limit", quantity: 100, limitPrice: 1,
    });
    const second = await connect(app);
    const orders = snapshot(second.messages);

    expect(orders.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: added.id, status: "pending" },
      { id: cancel.id, status: "cancelled" },
      { id: fill.id, status: "filled" },
    ]);
    expect(orders).toEqual((await app.inject({ method: "GET", url: "/api/orders?limit=50" })).json());
  });

  it("clears disconnected clients' previous orders after an in-memory account reset", async () => {
    const { app, system } = await createApp();
    system.broker.submitOrder({ symbol: "600519", side: "buy", type: "limit", quantity: 100, limitPrice: 1 });
    const first = await connect(app);
    expect(snapshot(first.messages)).toHaveLength(1);
    await disconnect(app, first.socket);
    system.broker.resetAccount({ startingCash: 20_000, strategyProfile: "balanced" });

    expect(snapshot((await connect(app)).messages)).toEqual([]);
  });
});
