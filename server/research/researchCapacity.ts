/** Safe, retryable admission failure; never includes cache keys or credentials. */
export class ResearchCapacityError extends Error {
  readonly statusCode = 503;
  constructor() {
    super("研究任务已达到并发上限，请稍后刷新；已有任务继续运行。");
    this.name = "ResearchCapacityError";
  }
}
