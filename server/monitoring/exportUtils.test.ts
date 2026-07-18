import { describe, expect, it } from "vitest";
import {
  contentType,
  exportAuditToCsv,
  exportFilename,
  exportOrdersToCsv,
  withBom,
} from "../monitoring/exportUtils";
import type { AuditEvent, OrderRecord } from "../../shared/trading";

describe("exportUtils", () => {
  const sampleOrders: OrderRecord[] = [
    {
      id: "order-1",
      symbol: "600519",
      name: "贵州茅台",
      side: "buy",
      type: "market",
      status: "filled",
      quantity: 100,
      filledQuantity: 100,
      requestedPrice: 1500.0,
      filledPrice: 1500.5,
      notional: 150050,
      commission: 5.0,
      rejectionReason: undefined,
      clientOrderId: "client-1",
      createdAt: "2026-07-11T08:00:00Z",
      updatedAt: "2026-07-11T08:00:01Z",
    },
    {
      id: "order-2",
      symbol: "000858",
      side: "sell",
      type: "limit",
      status: "rejected",
      quantity: 200,
      filledQuantity: 0,
      requestedPrice: 52.0,
      filledPrice: undefined,
      notional: 0,
      commission: 0,
      rejectionReason: "限价不满足",
      clientOrderId: undefined,
      createdAt: "2026-07-11T08:01:00Z",
      updatedAt: "2026-07-11T08:01:01Z",
    },
  ];

  const sampleAudit: AuditEvent[] = [
    {
      id: "audit-1",
      category: "order",
      action: "created",
      message: "订单已创建",
      timestamp: "2026-07-11T08:00:00Z",
      data: { orderId: "order-1" },
    },
    {
      id: "audit-2",
      category: "risk",
      action: "circuit_tripped",
      message: "熔断器已触发",
      timestamp: "2026-07-11T08:05:00Z",
    },
  ];

  describe("exportOrdersToCsv", () => {
    it("should produce valid CSV with header", () => {
      const csv = exportOrdersToCsv(sampleOrders);
      const lines = csv.split("\n");
      expect(lines[0]).toContain("id");
      expect(lines[0]).toContain("symbol");
      expect(lines[0]).toContain("name");
      expect(lines[0]).toContain("side");
      expect(lines[0]).toContain("status");
      expect(lines.length).toBe(3);
    });

    it("should include order data in CSV rows", () => {
      const csv = exportOrdersToCsv(sampleOrders);
      expect(csv).toContain("600519");
      expect(csv).toContain("贵州茅台");
      expect(csv).toContain("buy");
      expect(csv).toContain("filled");
      expect(csv).toContain("150050");
      expect(csv).toContain("限价不满足");
      expect(csv).toContain("rejected");
    });

    it("should handle empty orders array", () => {
      const csv = exportOrdersToCsv([]);
      const lines = csv.split("\n");
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain("id");
    });

    it("should handle rejectionReason with commas and quotes", () => {
      const orders: OrderRecord[] = [{
        id: "order-csv",
        symbol: "600519",
        side: "buy",
        type: "market",
        status: "rejected",
        quantity: 100,
        filledQuantity: 0,
        requestedPrice: 100,
        notional: 0,
        commission: 0,
        rejectionReason: '原因: "超出限额", 请联系管理员',
        createdAt: "2026-07-11T00:00:00Z",
        updatedAt: "2026-07-11T00:00:01Z",
      }];
      const csv = exportOrdersToCsv(orders);
      expect(csv).toContain('"原因: ""超出限额"", 请联系管理员"');
    });

    it("should handle undefined filledPrice as empty string", () => {
      const orders: OrderRecord[] = [{
        id: "order-no-fill",
        symbol: "300750",
        side: "sell",
        type: "limit",
        status: "pending",
        quantity: 100,
        filledQuantity: 0,
        requestedPrice: 250,
        filledPrice: undefined,
        notional: 0,
        commission: 0,
        createdAt: "2026-07-11T00:00:00Z",
        updatedAt: "2026-07-11T00:00:01Z",
      }];
      const csv = exportOrdersToCsv(orders);
      const lines = csv.split("\n");
      const fields = lines[1].split(",");
      const filledPriceIdx = 9;
      expect(fields[filledPriceIdx]).toBe("");
    });

    it("should handle single order", () => {
      const csv = exportOrdersToCsv([sampleOrders[0]]);
      const lines = csv.split("\n");
      expect(lines.length).toBe(2);
      expect(lines[1]).toContain("order-1");
    });

    it("should handle large orders array (1000 orders)", () => {
      const orders: OrderRecord[] = Array.from({ length: 1000 }, (_, i) => ({
        ...sampleOrders[0],
        id: `order-${i}`,
        clientOrderId: `client-${i}`,
      }));
      const csv = exportOrdersToCsv(orders);
      const lines = csv.split("\n");
      expect(lines.length).toBe(1001);
      expect(lines[0]).toContain("id");
    });
  });

  describe("exportAuditToCsv", () => {
    it("should produce valid CSV with header", () => {
      const csv = exportAuditToCsv(sampleAudit);
      const lines = csv.split("\n");
      expect(lines[0]).toContain("id");
      expect(lines[0]).toContain("category");
      expect(lines[0]).toContain("action");
      expect(lines[0]).toContain("message");
      expect(lines[0]).toContain("timestamp");
    });

    it("should include audit data", () => {
      const csv = exportAuditToCsv(sampleAudit);
      expect(csv).toContain("订单已创建");
      expect(csv).toContain("audit-1");
      expect(csv).toContain("circuit_tripped");
    });

    it("should handle undefined message", () => {
      const events: AuditEvent[] = [{
        id: "audit-x",
        category: "system",
        action: "start",
        message: "",
        timestamp: "2026-07-11T00:00:00Z",
      }];
      const csv = exportAuditToCsv(events);
      expect(csv).toContain("audit-x");
    });

    it("should handle messages with double quotes", () => {
      const events: AuditEvent[] = [{
        id: "audit-quote",
        category: "risk",
        action: "check",
        message: '检测到 "异常" 交易行为',
        timestamp: "2026-07-11T00:00:00Z",
      }];
      const csv = exportAuditToCsv(events);
      expect(csv).toContain('"检测到 ""异常"" 交易行为"');
    });

    it("should handle audit data with complex objects", () => {
      const events: AuditEvent[] = [{
        id: "audit-complex",
        category: "order",
        action: "filled",
        message: "成交",
        timestamp: "2026-07-11T00:00:00Z",
        data: { price: 150.5, quantity: 100, note: "test, with comma" },
      }];
      const csv = exportAuditToCsv(events);
      expect(csv).toContain("audit-complex");
      // CSV uses "" to escape double quotes, not \"
      expect(csv).toContain('""price"":150.5');
    });

    it("should handle empty audit array", () => {
      const csv = exportAuditToCsv([]);
      const lines = csv.split("\n");
      expect(lines.length).toBe(1);
    });

    it("should handle audit without data field", () => {
      const events: AuditEvent[] = [{
        id: "audit-no-data",
        category: "system",
        action: "heartbeat",
        message: "心跳检测",
        timestamp: "2026-07-11T00:00:00Z",
      }];
      const csv = exportAuditToCsv(events);
      expect(csv).toContain("audit-no-data");
      const lines = csv.split("\n");
      const fields = lines[1].split(",");
      expect(fields[5]).toBe('""');
    });
  });

  describe("withBom", () => {
    it("should prepend UTF-8 BOM", () => {
      const csv = "a,b,c\nd,e,f";
      const result = withBom(csv);
      expect(result.charCodeAt(0)).toBe(0xfeff);
      expect(result.slice(1)).toBe(csv);
    });

    it("should handle empty string", () => {
      const result = withBom("");
      expect(result.charCodeAt(0)).toBe(0xfeff);
      expect(result.length).toBe(1);
    });
  });

  describe("contentType", () => {
    it("should return CSV content type", () => {
      expect(contentType("csv")).toContain("text/csv");
      expect(contentType("csv")).toContain("utf-8");
    });

    it("should return JSON content type", () => {
      expect(contentType("json")).toContain("application/json");
    });
  });

  describe("exportFilename", () => {
    it("should include date and type", () => {
      const name = exportFilename("audit", "csv");
      expect(name).toMatch(/kairos-audit-\d{4}-\d{2}-\d{2}\.csv/);
    });

    it("should use correct extension for JSON", () => {
      const name = exportFilename("orders", "json");
      expect(name).toMatch(/\.json$/);
    });

    it("should distinguish audit from orders", () => {
      const auditName = exportFilename("audit", "csv");
      const ordersName = exportFilename("orders", "csv");
      expect(auditName).toContain("audit");
      expect(ordersName).toContain("orders");
      expect(auditName).not.toBe(ordersName);
    });
  });
});
