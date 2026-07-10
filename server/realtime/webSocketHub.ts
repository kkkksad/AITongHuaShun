import type { TradingEvent } from "../../shared/trading";

interface ClientSocket {
  readyState: number;
  send(payload: string): void;
  on(event: "close" | "error", listener: (...args: unknown[]) => void): void;
}

const OPEN_STATE = 1;

export class WebSocketHub {
  private readonly clients = new Set<ClientSocket>();

  add(socket: ClientSocket): void {
    this.clients.add(socket);
    const remove = () => this.clients.delete(socket);
    socket.on("close", remove);
    socket.on("error", remove);
  }

  send(socket: ClientSocket, event: TradingEvent): void {
    if (socket.readyState === OPEN_STATE) {
      socket.send(JSON.stringify(event));
    }
  }

  broadcast(event: TradingEvent): void {
    for (const socket of this.clients) {
      this.send(socket, event);
    }
  }

  get connectionCount(): number {
    return this.clients.size;
  }
}
