import type { TradingEvent } from "../../shared/trading";

interface ClientSocket {
  readyState: number;
  send(payload: string): void;
  on(event: "close" | "error" | "message" | "pong", listener: (...args: unknown[]) => void): void;
  ping(payload?: Buffer): void;
  terminate(): void;
}

const OPEN_STATE = 1;

interface ClientEntry {
  socket: ClientSocket;
  lastPong: number;
  pingTimer: ReturnType<typeof setInterval>;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 90_000;

export class WebSocketHub {
  private readonly clients = new Map<ClientSocket, ClientEntry>();

  add(socket: ClientSocket): void {
    const remove = () => {
      const entry = this.clients.get(socket);
      if (entry) {
        clearInterval(entry.pingTimer);
      }
      this.clients.delete(socket);
    };

    socket.on("close", remove);
    socket.on("error", remove);

    const pingTimer = setInterval(() => {
      if (socket.readyState === OPEN_STATE) {
        socket.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);

    const entry: ClientEntry = {
      socket,
      lastPong: Date.now(),
      pingTimer,
    };

    socket.on("pong", () => {
      entry.lastPong = Date.now();
    });

    this.clients.set(socket, entry);
  }

  isAlive(socket: ClientSocket): boolean {
    const entry = this.clients.get(socket);
    if (!entry) return false;
    return Date.now() - entry.lastPong < HEARTBEAT_TIMEOUT_MS;
  }

  send(socket: ClientSocket, event: TradingEvent): void {
    if (socket.readyState === OPEN_STATE) {
      socket.send(JSON.stringify(event));
    }
  }

  broadcast(event: TradingEvent): void {
    for (const [socket] of this.clients) {
      this.send(socket, event);
    }
  }

  pruneStale(): number {
    let pruned = 0;
    for (const [socket, entry] of this.clients) {
      if (Date.now() - entry.lastPong >= HEARTBEAT_TIMEOUT_MS) {
        clearInterval(entry.pingTimer);
        socket.terminate();
        this.clients.delete(socket);
        pruned += 1;
      }
    }
    return pruned;
  }

  get connectionCount(): number {
    return this.clients.size;
  }
}
