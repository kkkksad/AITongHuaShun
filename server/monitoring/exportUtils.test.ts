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
      expect(lines[0]).toContain("side");
      expect(lines[0]).toContain("status");
      expect(lines.length).toBe(3); // header + 2 rows
    });

    it("should include order data in CSV rows", () => {
      const csv = exportOrdersToCsv(sampleOrders);

      expect(csv).toContain("600519");
      expect(csv).toContain("buy");
      expect(csv).toContain("filled");
      expect(csv).toContain("150050");

      // Rejected order
      expect(csv).toContain("限价不满足");
      expect(csv).toContain("rejected");
    });

    it("should handle empty orders array", () => {
      const csv = exportOrdersToCsv([]);
      const lines = csv.split("\n");

      expect(lines.length).toBe(1); // header only
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
      const events: AuditEvent[] = [
        {
          id: "audit-x",
          category: "system",
          action: "start",
          message: "",
          timestamp: "2026-07-11T00:00:00Z",
        },
      ];
      const csv = exportAuditToCsv(events);
      expect(csv).toContain("audit-x");
    });
  });

  describe("withBom", () => {
    it("should prepend UTF-8 BOM", () => {
      const csv = "a,b,c\nd,e,f";
      const result = withBom(csv);

      // UTF-8 BOM is \uFEFF
      expect(result.charCodeAt(0)).toBe(0xfeff);
      expect(result.slice(1)).toBe(csv);
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
  });
});
