/**
 * 审计与交易日志导出工具。
 *
 * 支持 CSV 和 JSON 两种导出格式，含 UTF-8 BOM
 * 以确保 Excel 能正确识别中文编码。
 */
import type { AuditEvent, OrderRecord } from "../../shared/trading";

export type ExportFormat = "csv" | "json";

/** 将审计事件数组导出为 CSV 字符串 */
export function exportAuditToCsv(events: AuditEvent[]): string {
  const header = "id,category,action,message,timestamp,data";
  const rows = events.map((e) => {
    const data = e.data ? JSON.stringify(e.data).replace(/"/g, '""') : "";
    return [
      e.id,
      e.category,
      e.action,
      `"${(e.message ?? "").replace(/"/g, '""')}"`,
      e.timestamp,
      `"${data}"`,
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

/** 将订单记录数组导出为 CSV 字符串 */
export function exportOrdersToCsv(orders: OrderRecord[]): string {
  const header =
    "id,symbol,name,side,type,status,quantity,filledQuantity,requestedPrice,filledPrice,notional,commission,rejectionReason,clientOrderId,createdAt,updatedAt";
  const rows = orders.map((o) => {
    const reason = o.rejectionReason
      ? `"${o.rejectionReason.replace(/"/g, '""')}"`
      : "";
    return [
      o.id,
      o.symbol,
      o.name ?? "",
      o.side,
      o.type,
      o.status,
      o.quantity,
      o.filledQuantity,
      o.requestedPrice,
      o.filledPrice ?? "",
      o.notional,
      o.commission,
      reason,
      o.clientOrderId ?? "",
      o.createdAt,
      o.updatedAt,
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

/** 为 CSV 内容添加 UTF-8 BOM */
export function withBom(csvContent: string): string {
  return "\uFEFF" + csvContent;
}

/** 根据格式返回 Content-Type */
export function contentType(format: ExportFormat): string {
  if (format === "csv") return "text/csv; charset=utf-8";
  return "application/json; charset=utf-8";
}

/** 生成导出文件名 */
export function exportFilename(
  type: "audit" | "orders",
  format: ExportFormat,
): string {
  const date = new Date().toISOString().slice(0, 10);
  return `kairos-${type}-${date}.${format}`;
}
