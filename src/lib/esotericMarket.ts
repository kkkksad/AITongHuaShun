import type { MarketQuote, MarketSnapshot } from "../../shared/trading";

export type EsotericMethod = "yijing" | "wuxing" | "number";
export type EsotericMarketState =
  | "expanding"
  | "balanced"
  | "contracting"
  | "unavailable";
export type EsotericAlignment = "aligned" | "conflicted" | "unavailable";

export interface EsotericMarketContext {
  sampleCount: number;
  validCount: number;
  advancingCount: number;
  decliningCount: number;
  breadthRatio: number | null;
  averageChangePercent: number | null;
  averageAmplitudePercent: number | null;
  coverageRatio: number;
  freshnessMinutes: number | null;
  marketState: EsotericMarketState;
}

export interface EsotericMarketReadingInput {
  date: string;
  target: string;
  round?: number;
  method?: EsotericMethod;
  marketContext?: EsotericMarketContext;
}

export interface HexagramReference {
  number: number;
  name: string;
  theme: string;
  image: string;
}

export interface EsotericMarketReading {
  date: string;
  target: string;
  method: EsotericMethod;
  hexagram: HexagramReference;
  changingLine: number;
  element: string;
  tendency: string;
  observation: string;
  ritual: string;
  risk: string;
  seed: number;
  methodLens: string;
  symbolLayer: {
    state: Exclude<EsotericMarketState, "unavailable">;
    focus: string;
  };
  marketMirror: {
    state: EsotericMarketState;
    summary: string;
    evidence: string[];
  };
  alignment: EsotericAlignment;
  entertainmentIndex: number;
  reviewQuestions: [string, string];
}

const hexagrams: HexagramReference[] = [
  { number: 1, name: "乾为天", theme: "主动与开创", image: "天行健，重在自强与持续" },
  { number: 2, name: "坤为地", theme: "承载与等待", image: "地势坤，重在顺势与承接" },
  { number: 3, name: "水雷屯", theme: "起步多阻", image: "草木初生，先整理路径再推进" },
  { number: 4, name: "山水蒙", theme: "学习与求证", image: "山下出泉，先问清楚再行动" },
  { number: 5, name: "水天需", theme: "等待时机", image: "云上于天，等待条件成熟" },
  { number: 6, name: "天水讼", theme: "分歧与边界", image: "有孚窒惕，先明确规则与证据" },
  { number: 7, name: "地水师", theme: "纪律与组织", image: "容民畜众，重在队形和纪律" },
  { number: 8, name: "水地比", theme: "连接与选择", image: "地上有水，重在辨别可靠的连接" },
  { number: 9, name: "风天小畜", theme: "小有积累", image: "密云不雨，力量尚需积蓄" },
  { number: 10, name: "天泽履", theme: "谨慎行走", image: "履虎尾，不逞强也不失礼" },
  { number: 11, name: "地天泰", theme: "通达与交流", image: "天地交，重在保持流动" },
  { number: 12, name: "天地否", theme: "阻滞与收缩", image: "天地不交，先减少无效动作" },
  { number: 13, name: "天火同人", theme: "协作与共识", image: "同人于野，重在寻找共同依据" },
  { number: 14, name: "火天大有", theme: "资源与节制", image: "火在天上，拥有越多越要有边界" },
  { number: 15, name: "地山谦", theme: "谦抑与留余", image: "地中有山，锋芒藏于稳健" },
  { number: 16, name: "雷地豫", theme: "预备与节奏", image: "雷出地奋，先定节拍再舒展" },
  { number: 17, name: "泽雷随", theme: "跟随与适应", image: "泽中有雷，随时调整而不盲从" },
  { number: 18, name: "山风蛊", theme: "修复与清理", image: "山下有风，先处理积累的问题" },
  { number: 19, name: "地泽临", theme: "接近与观察", image: "泽上有地，靠近也要保持尺度" },
  { number: 20, name: "风地观", theme: "观察与复盘", image: "风行地上，先看全局再下判断" },
  { number: 21, name: "火雷噬嗑", theme: "厘清与执行", image: "雷电交作，去除阻塞才能前进" },
  { number: 22, name: "山火贲", theme: "形式与本质", image: "山下有火，外在清楚仍要核对内里" },
  { number: 23, name: "山地剥", theme: "剥落与减负", image: "山附于地，先守住核心" },
  { number: 24, name: "地雷复", theme: "回归与重启", image: "雷在地中，变化从小处重新发生" },
  { number: 25, name: "天雷无妄", theme: "真实与不妄", image: "天下雷行，去掉臆测与贪念" },
  { number: 26, name: "山天大畜", theme: "蓄力与约束", image: "天在山中，积累胜过急于释放" },
  { number: 27, name: "山雷颐", theme: "供养与输入", image: "山下有雷，留意自己正在吸收什么" },
  { number: 28, name: "泽风大过", theme: "压力与承重", image: "泽灭木，承重处需要额外检查" },
  { number: 29, name: "坎为水", theme: "反复与风险", image: "水洊至，低估风险会反复受困" },
  { number: 30, name: "离为火", theme: "清晰与依附", image: "明两作，信息清楚仍需有所依凭" },
  { number: 31, name: "泽山咸", theme: "感应与反馈", image: "山上有泽，尊重反馈而不被情绪牵引" },
  { number: 32, name: "雷风恒", theme: "恒常与纪律", image: "雷风相与，持续执行胜过频繁切换" },
  { number: 33, name: "天山遁", theme: "退守与保留", image: "天下有山，适度退让也是主动" },
  { number: 34, name: "雷天大壮", theme: "力量与克制", image: "雷在天上，力量越强越要防止过度" },
  { number: 35, name: "火地晋", theme: "进展与展示", image: "明出地上，进展需要光照也需要证据" },
  { number: 36, name: "地火明夷", theme: "藏明与防守", image: "明入地中，先保护判断力" },
  { number: 37, name: "风火家人", theme: "秩序与分工", image: "风自火出，先管好自己的边界" },
  { number: 38, name: "火泽睽", theme: "差异与核对", image: "上火下泽，分歧中要避免单一视角" },
  { number: 39, name: "水山蹇", theme: "艰难与绕行", image: "山上有水，正面受阻时先换路径" },
  { number: 40, name: "雷水解", theme: "解除与松绑", image: "雷雨作，先解决实际阻碍" },
  { number: 41, name: "山泽损", theme: "减损与取舍", image: "山下有泽，减少负担才能保持稳定" },
  { number: 42, name: "风雷益", theme: "增益与互惠", image: "风雷相助，增加也要看代价" },
  { number: 43, name: "泽天夬", theme: "决断与公告", image: "泽上于天，清楚表达但不莽撞" },
  { number: 44, name: "天风姤", theme: "偶遇与诱惑", image: "天下有风，突发机会需要先辨真假" },
  { number: 45, name: "泽地萃", theme: "聚集与筛选", image: "泽上于地，聚集之后还要筛选" },
  { number: 46, name: "地风升", theme: "渐进与积累", image: "木生于地，步步上行不求一步到位" },
  { number: 47, name: "泽水困", theme: "受困与节能", image: "泽无水，先保存力量与现金" },
  { number: 48, name: "水风井", theme: "基础与长期", image: "木上有水，基础设施比表面热闹重要" },
  { number: 49, name: "泽火革", theme: "变化与更新", image: "泽中有火，改变前先确认旧秩序已到边界" },
  { number: 50, name: "火风鼎", theme: "重构与承载", image: "木上有火，重构需要稳定容器" },
  { number: 51, name: "震为雷", theme: "突发与应对", image: "洊雷震，先稳住反应再判断" },
  { number: 52, name: "艮为山", theme: "止与边界", image: "兼山艮，知道何时停止" },
  { number: 53, name: "风山渐", theme: "渐进与次序", image: "山上有木，按步骤积累位置" },
  { number: 54, name: "雷泽归妹", theme: "关系与顺序", image: "泽上有雷，顺序错位时要降低期待" },
  { number: 55, name: "雷火丰", theme: "高峰与盛极", image: "雷电皆至，热闹处更要看持续性" },
  { number: 56, name: "火山旅", theme: "流动与暂居", image: "山上有火，临时状态不宜当作长期趋势" },
  { number: 57, name: "巽为风", theme: "渗透与分步", image: "随风巽，信息逐步进入而非一次定论" },
  { number: 58, name: "兑为泽", theme: "交流与愉悦", image: "丽泽兑，情绪回暖仍需事实确认" },
  { number: 59, name: "风水涣", theme: "分散与疏通", image: "风行水上，先疏通拥堵的信息" },
  { number: 60, name: "水泽节", theme: "节制与限额", image: "泽上有水，给行动设定清晰上限" },
  { number: 61, name: "风泽中孚", theme: "诚信与内核", image: "泽上有风，外部信号要回到内在证据" },
  { number: 62, name: "雷山小过", theme: "小事与谨慎", image: "山上有雷，小幅调整优于大动作" },
  { number: 63, name: "水火既济", theme: "完成与守成", image: "水在火上，完成之后仍需守住秩序" },
  { number: 64, name: "火水未济", theme: "未完与复核", image: "火在水上，事情尚未完成不可提前庆祝" },
];

const elements = ["木", "火", "土", "金", "水"] as const;
const tendencies = [
  "先观察后行动",
  "顺势记录，不追逐情绪",
  "把注意力放在证据和边界",
  "降低频率，等待下一次确认",
] as const;
const observations = [
  "今天适合把盘面变化写成可复核的事实，不适合用单一象意替代行情。",
  "先看量价、趋势和风险检查是否一致，再决定是否继续研究。",
  "若现实数据与象意冲突，以真实行情、策略规则和风险限制为准。",
  "把这次结果当成观察提示，收盘后再复盘它是否有任何可验证价值。",
] as const;
const rituals = [
  "开盘前写下一个可证伪的观察条件。",
  "盘中只记录一次重要变化，避免被连续波动牵着走。",
  "为任何纸面动作保留理由、价格、数量和风险上限。",
  "收盘后把象意与真实结果分栏记录，不修改历史结论。",
] as const;

function hashText(input: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function normalizeRound(round: number | undefined): number {
  if (round == null || !Number.isFinite(round)) return 0;
  return Math.max(0, Math.floor(round));
}

function roundNumber(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function quoteAmplitude(quote: MarketQuote): number {
  if (quote.amplitude !== undefined && Number.isFinite(quote.amplitude)) {
    return Math.max(0, quote.amplitude);
  }
  if (
    quote.high !== undefined &&
    quote.low !== undefined &&
    quote.high >= quote.low &&
    quote.previousClose > 0
  ) {
    return Math.max(0, ((quote.high - quote.low) / quote.previousClose) * 100);
  }
  return Math.abs(quote.changePercent) * 1.5;
}

export function summarizeEsotericMarketContext(
  market: MarketSnapshot | undefined,
  now = new Date(),
): EsotericMarketContext {
  const tradable = market?.quotes.filter((quote) => quote.tradable) ?? [];
  const valid = tradable.filter((quote) =>
    quote.price > 0 &&
    quote.previousClose > 0 &&
    Number.isFinite(quote.changePercent),
  );
  const validCount = valid.length;
  const sampleCount = tradable.length;
  const coverageRatio = sampleCount > 0 ? validCount / sampleCount : 0;
  const sufficient = validCount >= 3 && coverageRatio >= 0.5;

  if (!sufficient) {
    return {
      sampleCount,
      validCount,
      advancingCount: valid.filter((quote) => quote.changePercent > 0).length,
      decliningCount: valid.filter((quote) => quote.changePercent < 0).length,
      breadthRatio: null,
      averageChangePercent: null,
      averageAmplitudePercent: null,
      coverageRatio: roundNumber(coverageRatio, 4),
      freshnessMinutes: null,
      marketState: "unavailable",
    };
  }

  const advancingCount = valid.filter((quote) => quote.changePercent > 0).length;
  const decliningCount = valid.filter((quote) => quote.changePercent < 0).length;
  const breadthRatio = advancingCount / validCount;
  const averageChangePercent = valid.reduce(
    (sum, quote) => sum + quote.changePercent,
    0,
  ) / validCount;
  const averageAmplitudePercent = valid.reduce(
    (sum, quote) => sum + quoteAmplitude(quote),
    0,
  ) / validCount;
  const freshnessSamples = valid.flatMap((quote) => {
    const updatedAt = new Date(quote.updatedAt).getTime();
    if (!Number.isFinite(updatedAt)) return [];
    return [Math.max(0, (now.getTime() - updatedAt) / 60_000)];
  });
  const freshnessMinutes = freshnessSamples.length > 0
    ? freshnessSamples.reduce((sum, age) => sum + age, 0) /
      freshnessSamples.length
    : null;
  const marketState: EsotericMarketState =
    breadthRatio >= 0.6 && averageChangePercent >= 0.3
      ? "expanding"
      : breadthRatio <= 0.4 && averageChangePercent <= -0.3
        ? "contracting"
        : "balanced";

  return {
    sampleCount,
    validCount,
    advancingCount,
    decliningCount,
    breadthRatio: roundNumber(breadthRatio, 4),
    averageChangePercent: roundNumber(averageChangePercent),
    averageAmplitudePercent: roundNumber(averageAmplitudePercent),
    coverageRatio: roundNumber(coverageRatio, 4),
    freshnessMinutes: freshnessMinutes === null
      ? null
      : roundNumber(freshnessMinutes, 1),
    marketState,
  };
}

function symbolicState(seed: number): Exclude<EsotericMarketState, "unavailable"> {
  const index = (seed >>> 19) % 3;
  if (index === 0) return "expanding";
  if (index === 1) return "contracting";
  return "balanced";
}

function methodLens(
  method: EsotericMethod,
  element: (typeof elements)[number],
  changingLine: number,
  target: string,
): string {
  if (method === "wuxing") {
    return `五行节律以${element}为当次文化锚点，观察${target}的强弱转换是否有连续事实。`;
  }
  if (method === "number") {
    return `数字起卦聚焦日期、对象与轮次的固定节律，只比较本次记录与收盘事实。`;
  }
  return `易经卦象聚焦第 ${changingLine} 爻的变化张力，提醒先核对条件是否真的发生。`;
}

function stateLabel(state: EsotericMarketState): string {
  if (state === "expanding") return "扩张";
  if (state === "contracting") return "收缩";
  if (state === "balanced") return "均衡";
  return "不可用";
}

function buildMarketMirror(context: EsotericMarketContext | undefined): EsotericMarketReading["marketMirror"] {
  if (!context || context.marketState === "unavailable") {
    return {
      state: "unavailable",
      summary: "真实快照样本不足，今天只保留文化记录，不比较盘面。",
      evidence: ["需要至少 3 个有效可交易报价且覆盖率不低于 50%。"],
    };
  }
  return {
    state: context.marketState,
    summary: `现实样本处于${stateLabel(context.marketState)}状态，上涨宽度 ${((context.breadthRatio ?? 0) * 100).toFixed(0)}%，平均涨跌 ${(context.averageChangePercent ?? 0).toFixed(2)}%。`,
    evidence: [
      `有效报价 ${context.validCount}/${context.sampleCount}，上涨 ${context.advancingCount}、下跌 ${context.decliningCount}。`,
      `平均振幅 ${(context.averageAmplitudePercent ?? 0).toFixed(2)}%，平均新鲜度 ${context.freshnessMinutes?.toFixed(1) ?? "--"} 分钟。`,
    ],
  };
}

function buildReviewQuestions(
  method: EsotericMethod,
  target: string,
  context: EsotericMarketContext | undefined,
): [string, string] {
  const methodQuestion = method === "wuxing"
    ? `收盘时，${target}的量价强弱是否出现了可以记录的转换？`
    : method === "number"
      ? `本次固定索引对应的观察与${target}收盘事实有何差异？`
      : `第一个被验证或证伪的条件是什么，发生在什么时间？`;
  const marketQuestion = context?.marketState === "unavailable"
    ? "真实快照为何不足，数据恢复后结论是否需要标记为不可比较？"
    : "收盘时上涨宽度、平均涨跌和振幅是否仍支持盘中看到的状态？";
  return [methodQuestion, marketQuestion];
}

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createEsotericMarketReading(
  input: EsotericMarketReadingInput,
): EsotericMarketReading {
  const target = input.target.trim() || "今日大盘";
  const round = normalizeRound(input.round);
  const method = input.method ?? "yijing";
  const seed = hashText(`${input.date}|${target}|${method}|${round}`);
  const hexagram = hexagrams[seed % hexagrams.length];
  const element = elements[(seed >>> 5) % elements.length];
  const tendency = tendencies[(seed >>> 8) % tendencies.length];
  const changingLine = (seed % 6) + 1;
  const symbolState = symbolicState(seed);
  const marketMirror = buildMarketMirror(input.marketContext);
  const alignment: EsotericAlignment = marketMirror.state === "unavailable"
    ? "unavailable"
    : symbolState === marketMirror.state ||
        symbolState === "balanced" ||
        marketMirror.state === "balanced"
      ? "aligned"
      : "conflicted";

  return {
    date: input.date,
    target,
    method,
    hexagram,
    changingLine,
    element,
    tendency,
    observation: observations[(seed >>> 12) % observations.length],
    ritual: rituals[(seed >>> 16) % rituals.length],
    risk: "玄学结果不具备预测能力，不得据此开仓、加仓、减仓或修改风险限额。",
    seed,
    methodLens: methodLens(method, element, changingLine, target),
    symbolLayer: {
      state: symbolState,
      focus: `${stateLabel(symbolState)}象意 · ${hexagram.theme}`,
    },
    marketMirror,
    alignment,
    entertainmentIndex: (seed >>> 21) % 101,
    reviewQuestions: buildReviewQuestions(method, target, input.marketContext),
  };
}

export function getEsotericMethodLabel(method: EsotericMethod): string {
  if (method === "wuxing") return "五行节律";
  if (method === "number") return "数字起卦";
  return "易经卦象";
}
