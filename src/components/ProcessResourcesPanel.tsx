import type { ProcessResourceSnapshot } from "../../shared/systemMonitoring";

const mib = (bytes: number) => (bytes / 1024 ** 2).toFixed(1);
const time = (value: string) => new Date(value).toLocaleTimeString("zh-CN", { hour12: false });

export function ProcessResourcesPanel({ resources }: { resources?: ProcessResourceSnapshot }) {
  if (!resources) return <p className="empty-copy">进程资源未接入：当前响应没有资源测量，更新后端后再查看。</p>;
  const interval = resources.interval;
  return <section className="system-process-resources" aria-label="API 进程资源">
    <div className="system-route-heading">
      <div><span className="section-kicker">资源观察</span><h3>API 进程资源</h3></div>
      <small>内存测量 {time(resources.observedAt)}</small>
    </div>
    <div className="system-monitor-summary">
      <article><span>驻留内存 RSS</span><strong>{mib(resources.memory.rssBytes)} MiB</strong><small>API 进程当前驻留物理内存</small></article>
      <article><span>JavaScript 堆</span><strong>{mib(resources.memory.heapUsedBytes)} / {mib(resources.memory.heapTotalBytes)} MiB</strong><small>已用 / 当前分配；不是内存额度</small></article>
      <article><span>CPU · 单核 100%</span><strong>{interval ? `${interval.cpuPercentOfOneCore.toFixed(1)}%` : "等待样本"}</strong><small>可超过 100%，表示多个核的累计用量</small></article>
      <article><span>事件循环</span><strong>{interval?.eventLoopUtilization != null ? `${(interval.eventLoopUtilization * 100).toFixed(1)}%` : "等待样本"}</strong><small>{interval?.eventLoopDelayP95Ms != null ? `延迟 P95 ${interval.eventLoopDelayP95Ms.toFixed(1)} ms` : "暂无延迟样本"}</small></article>
    </div>
    <p className="empty-copy">{interval
      ? `计算区间 ${time(interval.startedAt)} — ${time(interval.endedAt)} · ${(interval.durationMs / 1000).toFixed(1)} 秒（按单调时钟计时）。`
      : "等待至少一秒的统计区间，稍后刷新可查看 CPU 与事件循环数据。"}
      仅 API 进程，不代表整台服务器或其他容器的资源；RSS 与堆有重叠，不应相加。延迟采样分辨率为 20 ms，单次资源观察不能确定接口或交易故障原因。
    </p>
  </section>;
}
