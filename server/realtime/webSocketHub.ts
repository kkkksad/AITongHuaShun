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
    if (this.clients.has(socket)) return;
    const remove = () => this.remove(socket);

    socket.on("close", remove);
    socket.on("error", remove);

    const pingTimer = setInterval(() => {
      const current = this.clients.get(socket);
      if (!current) return;
      if (Date.now() - current.lastPong >= HEARTBEAT_TIMEOUT_MS) {
        this.discard(socket);
        return;
      }
      if (socket.readyState === OPEN_STATE) {
        try {
          socket.ping();
        } catch {
          this.discard(socket);
        }
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
      // Serialization failures are server errors; only isolate transport errors.
      const payload = JSON.stringify(event);
      try {
        socket.send(payload);
      } catch {
        this.discard(socket);
      }
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
        this.discard(socket);
        pruned += 1;
      }
    }
    return pruned;
  }

  get connectionCount(): number {
    return this.clients.size;
  }

  private remove(socket: ClientSocket): void {
    const entry = this.clients.get(socket);
    if (entry) clearInterval(entry.pingTimer);
    this.clients.delete(socket);
  }

  private discard(socket: ClientSocket): void {
    // Remove local state first: termination itself may throw or emit close.
    this.remove(socket);
    try {
      socket.terminate();
    } catch {
      // A broken peer cannot interrupt the caller or another peer's cleanup.
    }
  }
}
