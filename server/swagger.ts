import type { ServerConfig } from "./config";

/**
 * 构建 OpenAPI 3.0 规范对象。
 * 与 @fastify/swagger 的内联 schema 互补，独立于 Fastify，
 * 便于通过 swagger-ui-express 提供交互式文档。
 */
export function buildOpenApiSpec(config: ServerConfig) {
  const serverUrl = `http://${config.API_HOST}:${config.API_PORT}`;

  return {
    openapi: "3.0.0",
    info: {
      title: "AI量化 API",
      version: "1.0.0",
      description:
        "AI量化交易工作台 API —— 提供账户管理、订单交易、持仓查询、行情数据、回测分析、审计导出和系统监控等功能。当前为模拟交易模式，不执行真实订单。",
    },
    servers: [
      {
        url: serverUrl,
        description: "本地开发服务器",
      },
    ],
    tags: [
      { name: "系统", description: "健康检查与服务状态" },
      { name: "行情", description: "市场行情数据" },
      { name: "账户", description: "账户、持仓与订单管理" },
      { name: "交易", description: "下单、撤单与交易控制" },
      { name: "风控", description: "风险控制与熔断管理" },
      { name: "审计", description: "交易审计事件查询" },
      { name: "导出", description: "审计日志与交易记录导出" },
      { name: "监控", description: "Prometheus 指标端点" },
    ],
    paths: {
      // ── 系统 ──
      "/api/health": {
        get: {
          tags: ["系统"],
          summary: "健康检查",
          description: "返回服务运行状态、模式和 WebSocket 连接数",
          responses: {
            "200": {
              description: "服务正常运行",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      service: { type: "string", example: "kairos-trading-api" },
                      mode: { type: "string", example: "mock" },
                      marketDataProvider: {
                        type: "string",
                        enum: ["mock", "akshare"],
                        example: "mock",
                      },
                      realTradingEnabled: { type: "boolean", example: false },
                      websocketConnections: { type: "number", example: 0 },
                      timestamp: {
                        type: "string",
                        format: "date-time",
                        example: "2026-07-11T00:00:00.000Z",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/capabilities": {
        get: {
          tags: ["系统"],
          summary: "获取系统能力边界",
          description: "明确区分只读行情来源与本地纸面订单执行能力",
          responses: {
            "200": {
              description: "系统能力信息",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      marketData: {
                        type: "object",
                        properties: {
                          provider: { type: "string" },
                          mode: { type: "string" },
                          readOnly: { type: "boolean" },
                          external: { type: "boolean" },
                        },
                      },
                      execution: {
                        type: "object",
                        properties: {
                          provider: { type: "string" },
                          mode: { type: "string" },
                          liveSupported: { type: "boolean" },
                          humanApprovalRequiredForLive: { type: "boolean" },
                        },
                      },
                      credentials: {
                        type: "object",
                        properties: {
                          browserAllowed: { type: "boolean" },
                          storage: { type: "string" },
                        },
                      },
                      openApi: {
                        type: "string",
                        nullable: true,
                        example: "/documentation/json",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── 行情 ──
      "/api/market/snapshot": {
        get: {
          tags: ["行情"],
          summary: "获取市场快照",
          description: "返回当前所有监控标的的实时行情快照",
          responses: {
            "200": {
              description: "市场快照数据",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      mode: { type: "string", example: "mock" },
                      sequence: { type: "number", example: 42 },
                      marketTime: {
                        type: "string",
                        format: "date-time",
                      },
                      quotes: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            symbol: { type: "string", example: "600519" },
                            name: { type: "string", example: "贵州茅台" },
                            tradable: { type: "boolean", example: true },
                            price: { type: "number", example: 1800.5 },
                            previousClose: { type: "number", example: 1790.0 },
                            changePercent: { type: "number", example: 0.59 },
                            volume: { type: "number", example: 12345678 },
                            updatedAt: {
                              type: "string",
                              format: "date-time",
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── 账户 ──
      "/api/account": {
        get: {
          tags: ["账户"],
          summary: "获取账户快照",
          description: "返回当前账户权益、现金、持仓市值等信息",
          responses: {
            "200": {
              description: "账户快照数据",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      accountId: { type: "string", example: "paper-001" },
                      mode: { type: "string", example: "mock" },
                      cash: { type: "number", example: 950000.0 },
                      equity: { type: "number", example: 1005000.0 },
                      marketValue: { type: "number", example: 55000.0 },
                      unrealizedPnl: { type: "number", example: 5000.0 },
                      realizedPnl: { type: "number", example: 1200.0 },
                      dailyPnl: { type: "number", example: 6200.0 },
                      dailyPnlPercent: { type: "number", example: 0.62 },
                      riskUtilization: { type: "number", example: 0.15 },
                      paused: { type: "boolean", example: false },
                      updatedAt: {
                        type: "string",
                        format: "date-time",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/positions": {
        get: {
          tags: ["账户"],
          summary: "获取持仓列表",
          description: "返回当前所有持仓及市值信息",
          responses: {
            "200": {
              description: "持仓列表",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        symbol: { type: "string", example: "600519" },
                        name: { type: "string", example: "贵州茅台" },
                        quantity: { type: "number", example: 100 },
                        averagePrice: { type: "number", example: 1750.0 },
                        currentPrice: { type: "number", example: 1800.5 },
                        marketValue: { type: "number", example: 180050.0 },
                        unrealizedPnl: { type: "number", example: 5050.0 },
                        realizedPnl: { type: "number", example: 0 },
                        weight: { type: "number", example: 0.18 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── 订单 ──
      "/api/orders": {
        get: {
          tags: ["账户"],
          summary: "获取订单列表",
          description: "返回最近的订单记录，支持 limit 参数控制数量",
          parameters: [
            {
              name: "limit",
              in: "query",
              description: "返回订单数量上限（1-500）",
              schema: { type: "integer", default: 100, minimum: 1, maximum: 500 },
            },
          ],
          responses: {
            "200": {
              description: "订单列表",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string", example: "ord-abc123" },
                        symbol: { type: "string", example: "600519" },
                        side: { type: "string", enum: ["buy", "sell"] },
                        type: { type: "string", enum: ["market", "limit"] },
                        quantity: { type: "integer", example: 100 },
                        status: {
                          type: "string",
                          enum: ["accepted", "filled", "rejected", "cancelled", "pending"],
                        },
                        requestedPrice: { type: "number" },
                        filledPrice: { type: "number", nullable: true },
                        filledQuantity: { type: "integer" },
                        notional: { type: "number" },
                        commission: { type: "number" },
                        rejectionReason: { type: "string", nullable: true },
                        createdAt: { type: "string", format: "date-time" },
                        updatedAt: { type: "string", format: "date-time" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["交易"],
          summary: "提交订单",
          description: "提交市价单或限价单到模拟交易系统",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["symbol", "side", "quantity"],
                  properties: {
                    symbol: {
                      type: "string",
                      description: "6位股票代码",
                      pattern: "^\\d{6}$",
                      example: "600519",
                    },
                    side: {
                      type: "string",
                      enum: ["buy", "sell"],
                      description: "买卖方向",
                    },
                    type: {
                      type: "string",
                      enum: ["market", "limit"],
                      default: "market",
                      description: "订单类型",
                    },
                    quantity: {
                      type: "integer",
                      description: "委托数量（股）",
                      example: 100,
                    },
                    limitPrice: {
                      type: "number",
                      description: "限价（限价单必填）",
                      example: 1800.0,
                    },
                    clientOrderId: {
                      type: "string",
                      description: "客户端订单ID（可选，用于幂等）",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "订单创建成功",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      order: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          symbol: { type: "string" },
                          side: { type: "string" },
                          status: { type: "string" },
                          requestedPrice: { type: "number" },
                          filledPrice: { type: "number", nullable: true },
                          filledQuantity: { type: "integer" },
                          notional: { type: "number" },
                          commission: { type: "number" },
                          createdAt: { type: "string", format: "date-time" },
                          updatedAt: { type: "string", format: "date-time" },
                        },
                      },
                      account: {
                        type: "object",
                        description: "更新后的账户快照",
                      },
                      positions: {
                        type: "array",
                        description: "更新后的持仓列表",
                        items: { type: "object" },
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description: "请求参数校验失败",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      error: { type: "string", example: "INVALID_REQUEST" },
                      message: { type: "string", example: "请求参数校验失败" },
                      issues: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            path: { type: "string" },
                            message: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/orders/{orderId}": {
        delete: {
          tags: ["交易"],
          summary: "撤销订单",
          description: "撤销指定ID的未成交订单",
          parameters: [
            {
              name: "orderId",
              in: "path",
              required: true,
              description: "订单ID",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "撤单成功",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      order: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          symbol: { type: "string" },
                          status: { type: "string", example: "cancelled" },
                        },
                      },
                      account: { type: "object" },
                      positions: { type: "array", items: { type: "object" } },
                    },
                  },
                },
              },
            },
            "400": {
              description: "撤单失败（订单不存在或已成交）",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      error: { type: "string", example: "INVALID_REQUEST" },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── 风控 ──
      "/api/risk/limits": {
        get: {
          tags: ["风控"],
          summary: "获取风控限额",
          description: "返回当前风控限额配置（单笔金额、仓位权重、日亏损上限等）",
          responses: {
            "200": {
              description: "风控限额配置",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      maxOrderNotional: { type: "number", example: 100000 },
                      maxPositionWeight: { type: "number", example: 0.25 },
                      maxDailyLoss: { type: "number", example: 0.05 },
                      lotSize: { type: "integer", example: 100 },
                      realTradingEnabled: { type: "boolean", example: false },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/risk/state": {
        get: {
          tags: ["风控"],
          summary: "获取风控状态",
          description: "返回熔断器状态、连续亏损次数、日内回撤等信息",
          responses: {
            "200": {
              description: "风控运行时状态",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      circuitState: {
                        type: "string",
                        enum: ["normal", "warning", "tripped"],
                        example: "normal",
                      },
                      consecutiveLosses: { type: "integer", example: 0 },
                      dailyDrawdown: { type: "number", example: 0.01 },
                      peakDailyEquity: { type: "number", example: 1000000 },
                      trippedAt: { type: "string", nullable: true },
                      warningAt: { type: "string", nullable: true },
                      tradeCount: { type: "integer", example: 15 },
                      lossCount: { type: "integer", example: 3 },
                      lastTradeTime: { type: "string", nullable: true },
                      lastEvaluationTime: { type: "string", nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/risk/reset": {
        post: {
          tags: ["风控"],
          summary: "重置熔断器",
          description: "手动重置熔断器状态，恢复正常交易",
          responses: {
            "200": {
              description: "熔断器已重置",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      circuitState: {
                        type: "string",
                        example: "normal",
                      },
                      message: { type: "string", example: "熔断器已重置" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── 交易控制 ──
      "/api/trading/pause": {
        post: {
          tags: ["交易"],
          summary: "暂停交易",
          description: "暂停模拟交易撮合，新订单将排队等待",
          responses: {
            "200": {
              description: "交易已暂停",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      account: { type: "object", description: "暂停后的账户快照" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/trading/resume": {
        post: {
          tags: ["交易"],
          summary: "恢复交易",
          description: "恢复模拟交易撮合，处理排队订单",
          responses: {
            "200": {
              description: "交易已恢复",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      account: { type: "object", description: "恢复后的账户快照" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── 审计 ──
      "/api/audit": {
        get: {
          tags: ["审计"],
          summary: "获取审计事件",
          description: "返回最近的交易审计事件记录",
          parameters: [
            {
              name: "limit",
              in: "query",
              description: "返回事件数量上限（1-500）",
              schema: { type: "integer", default: 100, minimum: 1, maximum: 500 },
            },
          ],
          responses: {
            "200": {
              description: "审计事件列表",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string", example: "audit-001" },
                        category: {
                          type: "string",
                          enum: ["market", "order", "risk", "account", "system"],
                        },
                        action: { type: "string", example: "order.submitted" },
                        message: { type: "string", example: "限价买单 600519 x100" },
                        timestamp: { type: "string", format: "date-time" },
                        data: { type: "object" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── 导出 ──
      "/api/audit/export": {
        get: {
          tags: ["导出"],
          summary: "导出审计日志",
          description: "以 CSV 或 JSON 格式导出审计事件记录",
          parameters: [
            {
              name: "format",
              in: "query",
              description: "导出格式",
              schema: {
                type: "string",
                enum: ["csv", "json"],
                default: "csv",
              },
            },
          ],
          responses: {
            "200": {
              description: "导出文件（CSV 含BOM，JSON 格式化）",
              content: {
                "text/csv": {
                  schema: { type: "string" },
                },
                "application/json": {
                  schema: { type: "string" },
                },
              },
            },
          },
        },
      },
      "/api/orders/export": {
        get: {
          tags: ["导出"],
          summary: "导出交易记录",
          description: "以 CSV 或 JSON 格式导出订单记录",
          parameters: [
            {
              name: "format",
              in: "query",
              description: "导出格式",
              schema: {
                type: "string",
                enum: ["csv", "json"],
                default: "csv",
              },
            },
          ],
          responses: {
            "200": {
              description: "导出文件（CSV 含BOM，JSON 格式化）",
              content: {
                "text/csv": {
                  schema: { type: "string" },
                },
                "application/json": {
                  schema: { type: "string" },
                },
              },
            },
          },
        },
      },

      // ── 监控 ──
      "/metrics": {
        get: {
          tags: ["监控"],
          summary: "Prometheus 指标",
          description:
            "以 Prometheus 文本格式返回 HTTP、WebSocket、订单和账户指标",
          responses: {
            "200": {
              description: "Prometheus 指标文本",
              content: {
                "text/plain": {
                  schema: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  };
}
