/**
 * 宏观事件/政策驱动分析引擎
 * 抓取财经快讯 → 关键词匹配 → 识别板块影响（利好/利空）
 */

// ==================== 事件→板块影响映射规则 ====================

interface EventRule {
  keywords: string[];           // 触发关键词（任一匹配即触发）
  mustMatch?: string[];         // 必须同时包含的词
  excludeWords?: string[];      // 排除词（包含则不触发）
  sectors: string[];            // 影响的板块
  impact: "利好" | "利空" | "关注";
  weight: number;               // 影响权重 1-10
  reason: string;               // 影响原因
  category: "国际局势" | "国家政策" | "央行货币" | "行业政策" | "贸易关系" | "突发事件" | "科技突破" | "大宗商品";
}

const EVENT_RULES: EventRule[] = [
  // ===== 国际局势 =====
  { keywords: ["战争", "军事冲突", "开战", "导弹", "空袭", "军事行动"],
    sectors: ["军工", "有色金属", "商品"], impact: "利好", weight: 8,
    reason: "地缘冲突推升军工需求和避险资产", category: "国际局势" },
  { keywords: ["战争", "军事冲突", "开战"],
    sectors: ["光伏风电", "新能源车", "大消费", "旅游"], impact: "利空", weight: 6,
    reason: "地缘冲突压制风险偏好和消费预期", category: "国际局势" },
  { keywords: ["停火", "和平协议", "停战", "和谈"],
    sectors: ["大消费", "旅游", "光伏风电"], impact: "利好", weight: 5,
    reason: "局势缓和提振消费和风险偏好", category: "国际局势" },
  { keywords: ["停火", "和平协议", "停战"],
    sectors: ["军工"], impact: "利空", weight: 4,
    reason: "和平预期降低军工需求", category: "国际局势" },
  { keywords: ["俄罗斯", "俄乌", "乌克兰"],
    mustMatch: ["冲突", "战争", "升级", "袭击", "核"],
    sectors: ["军工", "煤炭", "商品", "有色金属"], impact: "利好", weight: 7,
    reason: "俄乌冲突升级推升能源和资源品价格", category: "国际局势" },
  { keywords: ["中东", "以色列", "伊朗", "哈马斯", "胡塞"],
    mustMatch: ["冲突", "袭击", "战争", "打击", "升级"],
    sectors: ["军工", "商品", "煤炭"], impact: "利好", weight: 7,
    reason: "中东紧张推升油价和避险情绪", category: "国际局势" },
  { keywords: ["朝鲜", "半岛"],
    mustMatch: ["导弹", "核", "军事"],
    sectors: ["军工"], impact: "利好", weight: 6,
    reason: "半岛紧张局势利好军工板块", category: "国际局势" },
  { keywords: ["台海", "台湾"],
    mustMatch: ["军事", "演习", "紧张", "冲突"],
    sectors: ["军工", "半导体芯片"], impact: "关注", weight: 8,
    reason: "台海局势影响军工和半导体供应链", category: "国际局势" },

  // ===== 贸易关系 =====
  { keywords: ["关税", "贸易战", "加征关税", "贸易摩擦", "制裁"],
    mustMatch: ["中国", "中美", "美国"],
    sectors: ["半导体芯片", "人工智能", "通信5G"], impact: "关注", weight: 8,
    reason: "中美贸易摩擦影响科技自主可控", category: "贸易关系" },
  { keywords: ["关税", "加征关税"],
    mustMatch: ["中国", "中美"],
    sectors: ["大消费", "家电", "食品饮料"], impact: "利空", weight: 5,
    reason: "贸易摩擦压制出口和消费信心", category: "贸易关系" },
  { keywords: ["贸易协定", "关税下调", "贸易谈判", "贸易合作"],
    sectors: ["大消费", "家电", "港股", "美股"], impact: "利好", weight: 6,
    reason: "贸易关系改善利好出口和消费", category: "贸易关系" },
  { keywords: ["制裁", "出口管制", "实体清单", "芯片禁令"],
    sectors: ["半导体芯片", "人工智能", "通信5G"], impact: "关注", weight: 9,
    reason: "技术封锁加速国产替代，短空长多", category: "贸易关系" },
  { keywords: ["国产替代", "自主可控", "国产化"],
    sectors: ["半导体芯片", "人工智能", "军工"], impact: "利好", weight: 7,
    reason: "国产替代政策加速推动相关板块", category: "贸易关系" },

  // ===== 国家政策 =====
  { keywords: ["降准", "降息", "MLF", "LPR下调", "宽松"],
    sectors: ["银行", "房地产", "券商", "红利策略", "沪深300"], impact: "利好", weight: 8,
    reason: "货币宽松利好金融地产和权重", category: "央行货币" },
  { keywords: ["加息", "收紧", "上调准备金"],
    sectors: ["银行", "房地产", "券商"], impact: "利空", weight: 7,
    reason: "货币收紧压制金融和地产", category: "央行货币" },
  { keywords: ["美联储", "加息", "缩表"],
    sectors: ["港股", "美股", "有色金属"], impact: "利空", weight: 6,
    reason: "美联储收紧打压全球风险资产", category: "央行货币" },
  { keywords: ["美联储", "降息", "暂停加息", "鸽派"],
    sectors: ["港股", "美股", "有色金属", "创新药"], impact: "利好", weight: 7,
    reason: "美联储宽松利好港美股和贵金属", category: "央行货币" },
  { keywords: ["房地产", "房住不炒", "限购放开", "房贷", "公积金"],
    sectors: ["房地产", "银行", "建材基建", "家电"], impact: "利好", weight: 7,
    reason: "地产政策松绑利好产业链", category: "国家政策" },
  { keywords: ["基建", "新基建", "专项债", "基础设施"],
    sectors: ["建材基建", "煤炭", "有色金属"], impact: "利好", weight: 6,
    reason: "基建投资拉动上游需求", category: "国家政策" },
  { keywords: ["消费券", "促消费", "内需", "消费升级", "以旧换新"],
    sectors: ["大消费", "食品饮料", "家电", "旅游"], impact: "利好", weight: 6,
    reason: "促消费政策提振内需板块", category: "国家政策" },
  { keywords: ["新能源", "碳中和", "双碳", "绿电", "新能源补贴"],
    excludeWords: ["取消补贴"],
    sectors: ["新能源车", "光伏风电", "电力能源", "环保"], impact: "利好", weight: 7,
    reason: "双碳政策持续推动新能源产业", category: "行业政策" },
  { keywords: ["医保", "集采", "带量采购", "医保谈判"],
    sectors: ["创新药", "医药综合", "医疗器械"], impact: "利空", weight: 7,
    reason: "集采压缩利润空间，短期利空医药", category: "行业政策" },
  { keywords: ["创新药", "药品审批", "IND", "NDA", "FDA批准"],
    excludeWords: ["集采"],
    sectors: ["创新药", "医药综合"], impact: "利好", weight: 5,
    reason: "药品审批进展利好创新药", category: "行业政策" },
  { keywords: ["游戏版号", "版号", "游戏审批"],
    sectors: ["游戏传媒"], impact: "利好", weight: 7,
    reason: "版号发放利好游戏行业", category: "行业政策" },
  { keywords: ["数据安全", "反垄断", "平台经济"],
    mustMatch: ["整改", "处罚", "罚款"],
    sectors: ["港股", "游戏传媒"], impact: "利空", weight: 6,
    reason: "监管压力压制互联网平台", category: "行业政策" },
  { keywords: ["平台经济", "互联网", "数字经济"],
    mustMatch: ["支持", "鼓励", "发展", "规范"],
    excludeWords: ["罚款", "处罚"],
    sectors: ["港股", "人工智能", "游戏传媒"], impact: "利好", weight: 6,
    reason: "政策支持数字经济发展", category: "行业政策" },

  // ===== 行业政策 =====
  { keywords: ["芯片", "半导体", "大基金"],
    mustMatch: ["投资", "支持", "扶持", "注资", "基金"],
    sectors: ["半导体芯片"], impact: "利好", weight: 8,
    reason: "国家大基金注资半导体产业", category: "行业政策" },
  { keywords: ["人工智能", "AI", "大模型", "算力", "ChatGPT", "GPT"],
    sectors: ["人工智能", "通信5G", "半导体芯片"], impact: "利好", weight: 7,
    reason: "AI产业浪潮推动算力和芯片需求", category: "科技突破" },
  { keywords: ["机器人", "人形机器人", "具身智能"],
    sectors: ["人工智能", "军工"], impact: "利好", weight: 6,
    reason: "机器人产业突破利好相关板块", category: "科技突破" },
  { keywords: ["6G", "卫星互联网", "低空经济", "无人机"],
    sectors: ["通信5G", "军工"], impact: "利好", weight: 6,
    reason: "新通信技术和低空经济利好相关板块", category: "科技突破" },
  { keywords: ["自动驾驶", "智能驾驶", "车路协同"],
    sectors: ["新能源车", "人工智能"], impact: "利好", weight: 6,
    reason: "自动驾驶进展利好整车和AI", category: "科技突破" },
  { keywords: ["量子", "量子计算", "量子通信"],
    sectors: ["通信5G", "半导体芯片"], impact: "利好", weight: 5,
    reason: "量子技术突破利好相关板块", category: "科技突破" },

  // ===== 大宗商品 =====
  { keywords: ["油价", "原油", "OPEC", "减产"],
    mustMatch: ["上涨", "飙升", "大涨", "新高", "减产"],
    sectors: ["煤炭", "商品", "化工"], impact: "利好", weight: 7,
    reason: "油价上涨带动能源和化工品价格", category: "大宗商品" },
  { keywords: ["油价", "原油"],
    mustMatch: ["下跌", "暴跌", "崩盘", "增产"],
    sectors: ["煤炭", "化工"], impact: "利空", weight: 6,
    reason: "油价下跌拖累能源化工板块", category: "大宗商品" },
  { keywords: ["黄金", "金价"],
    mustMatch: ["上涨", "新高", "飙升", "大涨"],
    sectors: ["有色金属"], impact: "利好", weight: 6,
    reason: "金价上涨利好有色金属板块", category: "大宗商品" },
  { keywords: ["铜价", "铝价", "锂价", "稀土"],
    mustMatch: ["上涨", "涨价", "新高", "供不应求"],
    sectors: ["有色金属", "新能源车"], impact: "利好", weight: 6,
    reason: "金属涨价利好上游资源", category: "大宗商品" },
  { keywords: ["猪价", "猪肉", "生猪"],
    mustMatch: ["上涨", "涨价", "反弹"],
    sectors: ["农业"], impact: "利好", weight: 5,
    reason: "猪周期回升利好养殖板块", category: "大宗商品" },
  { keywords: ["粮食", "粮价", "大豆", "玉米"],
    mustMatch: ["上涨", "涨价", "危机", "安全"],
    sectors: ["农业", "商品"], impact: "利好", weight: 5,
    reason: "粮食安全和涨价利好农业板块", category: "大宗商品" },

  // ===== 突发事件 =====
  { keywords: ["疫情", "新冠", "变异株", "封控"],
    sectors: ["创新药", "医药综合", "医疗器械"], impact: "利好", weight: 7,
    reason: "疫情反复利好医药板块", category: "突发事件" },
  { keywords: ["疫情", "封控"],
    sectors: ["旅游", "大消费", "食品饮料"], impact: "利空", weight: 7,
    reason: "疫情封控冲击线下消费", category: "突发事件" },
  { keywords: ["地震", "洪水", "台风", "灾害"],
    sectors: ["建材基建"], impact: "利好", weight: 4,
    reason: "灾后重建拉动基建需求", category: "突发事件" },
  { keywords: ["数据泄露", "网络攻击", "信息安全"],
    sectors: ["人工智能", "通信5G"], impact: "利好", weight: 5,
    reason: "安全事件推动信息安全投入", category: "突发事件" },

  // ===== 市场事件 =====
  { keywords: ["IPO", "暂停IPO", "放缓IPO"],
    sectors: ["券商"], impact: "利空", weight: 5,
    reason: "IPO放缓影响券商投行收入", category: "国家政策" },
  { keywords: ["注册制", "全面注册制"],
    sectors: ["券商"], impact: "利好", weight: 6,
    reason: "注册制推进利好券商业务", category: "国家政策" },
  { keywords: ["印花税", "降低印花税"],
    sectors: ["券商", "沪深300", "创业板"], impact: "利好", weight: 8,
    reason: "降低印花税重大利好市场情绪", category: "国家政策" },
  { keywords: ["养老金", "社保基金", "险资入市", "长期资金"],
    sectors: ["红利策略", "银行", "沪深300"], impact: "利好", weight: 6,
    reason: "长期资金入市利好蓝筹和高股息", category: "国家政策" },
];

// ==================== 事件识别结果 ====================

export interface EventSignal {
  title: string;          // 新闻标题
  time: string;           // 时间
  category: string;       // 事件分类
  sectors: string[];      // 影响板块
  impact: "利好" | "利空" | "关注";
  weight: number;
  reason: string;
}

export interface SectorEventSummary {
  sector: string;
  bullishEvents: EventSignal[];
  bearishEvents: EventSignal[];
  watchEvents: EventSignal[];
  netImpact: number;      // 净影响分 (-100~100)
  summary: string;        // 一句话总结
}

// ==================== 新闻抓取 ====================

interface RawNews { title: string; time: string }

async function fetchFinanceNews(): Promise<RawNews[]> {
  const results: RawNews[] = [];

  try {
    // 东方财富快讯
    const resp = await fetch(
      "https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_50_1_.html",
      { headers: { "Referer": "https://kuaixun.eastmoney.com/" }, next: { revalidate: 120 } }
    );
    const text = await resp.text();
    const match = text.match(/var ajaxResult=(.+)/);
    if (match) {
      const json = JSON.parse(match[1]);
      for (const item of json.LivesList || []) {
        results.push({ title: item.title || "", time: item.showtime || "" });
      }
    }
  } catch {}

  try {
    // 东方财富7x24要闻
    const resp2 = await fetch(
      "https://newsapi.eastmoney.com/kuaixun/v1/getlist_101_ajaxResult_30_1_.html",
      { headers: { "Referer": "https://kuaixun.eastmoney.com/" }, next: { revalidate: 120 } }
    );
    const text2 = await resp2.text();
    const match2 = text2.match(/var ajaxResult=(.+)/);
    if (match2) {
      const json2 = JSON.parse(match2[1]);
      for (const item of json2.LivesList || []) {
        if (!results.find(r => r.title === item.title)) {
          results.push({ title: item.title || "", time: item.showtime || "" });
        }
      }
    }
  } catch {}

  return results;
}

// ==================== 事件匹配 ====================

function matchEvents(news: RawNews[]): EventSignal[] {
  const signals: EventSignal[] = [];

  for (const item of news) {
    const title = item.title;
    if (!title || title.length < 5) continue;

    for (const rule of EVENT_RULES) {
      // 检查关键词
      const hasKeyword = rule.keywords.some(kw => title.includes(kw));
      if (!hasKeyword) continue;

      // 检查必须匹配词
      if (rule.mustMatch && !rule.mustMatch.some(m => title.includes(m))) continue;

      // 检查排除词
      if (rule.excludeWords && rule.excludeWords.some(e => title.includes(e))) continue;

      signals.push({
        title: title.substring(0, 60),
        time: item.time,
        category: rule.category,
        sectors: rule.sectors,
        impact: rule.impact,
        weight: rule.weight,
        reason: rule.reason,
      });
    }
  }

  // 去重：同一标题对同一板块只保留最高权重
  const deduped: EventSignal[] = [];
  const seen = new Set<string>();
  signals.sort((a, b) => b.weight - a.weight);
  for (const s of signals) {
    const key = `${s.title}|${s.sectors.join(",")}|${s.impact}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(s);
    }
  }

  return deduped;
}

// ==================== 按板块汇总 ====================

function summarizeBySector(events: EventSignal[]): SectorEventSummary[] {
  const sectorMap: Record<string, { bull: EventSignal[]; bear: EventSignal[]; watch: EventSignal[] }> = {};

  for (const e of events) {
    for (const sector of e.sectors) {
      if (!sectorMap[sector]) sectorMap[sector] = { bull: [], bear: [], watch: [] };
      if (e.impact === "利好") sectorMap[sector].bull.push(e);
      else if (e.impact === "利空") sectorMap[sector].bear.push(e);
      else sectorMap[sector].watch.push(e);
    }
  }

  return Object.entries(sectorMap).map(([sector, data]) => {
    const bullScore = data.bull.reduce((s, e) => s + e.weight * 5, 0);
    const bearScore = data.bear.reduce((s, e) => s + e.weight * 5, 0);
    const netImpact = Math.max(-100, Math.min(100, bullScore - bearScore));

    let summary: string;
    if (data.bull.length > 0 && data.bear.length === 0) {
      summary = `有${data.bull.length}条利好消息：${data.bull[0].reason}`;
    } else if (data.bear.length > 0 && data.bull.length === 0) {
      summary = `有${data.bear.length}条利空消息：${data.bear[0].reason}`;
    } else if (data.bull.length > 0 && data.bear.length > 0) {
      summary = `多空交织（${data.bull.length}利好/${data.bear.length}利空）`;
    } else {
      summary = `有${data.watch.length}条需关注的消息`;
    }

    return {
      sector,
      bullishEvents: data.bull,
      bearishEvents: data.bear,
      watchEvents: data.watch,
      netImpact,
      summary,
    };
  }).sort((a, b) => Math.abs(b.netImpact) - Math.abs(a.netImpact));
}

// ==================== 主入口 ====================

export interface EventAnalysis {
  events: EventSignal[];
  sectorSummaries: SectorEventSummary[];
  topEvents: EventSignal[];       // 权重最高的事件
  timestamp: string;
}

export async function analyzeEvents(): Promise<EventAnalysis> {
  const news = await fetchFinanceNews();
  const events = matchEvents(news);
  const sectorSummaries = summarizeBySector(events);
  const topEvents = events.filter(e => e.weight >= 6).slice(0, 10);

  return {
    events,
    sectorSummaries,
    topEvents,
    timestamp: new Date().toISOString(),
  };
}

// 获取某个板块的事件驱动评分（供决策引擎调用）
export function getSectorEventScore(sector: string, sectorSummaries: SectorEventSummary[]): {
  score: number;
  signals: { category: string; indicator: string; value: string; judgment: string; bullish: boolean; weight: number }[];
} {
  const match = sectorSummaries.find(s => s.sector === sector);
  if (!match) return { score: 0, signals: [] };

  const signals: { category: string; indicator: string; value: string; judgment: string; bullish: boolean; weight: number }[] = [];

  for (const e of match.bullishEvents.slice(0, 2)) {
    signals.push({
      category: "事件", indicator: `${e.category}利好`, value: e.title,
      judgment: e.reason, bullish: true, weight: Math.min(8, e.weight),
    });
  }
  for (const e of match.bearishEvents.slice(0, 2)) {
    signals.push({
      category: "事件", indicator: `${e.category}利空`, value: e.title,
      judgment: e.reason, bullish: false, weight: -Math.min(8, e.weight),
    });
  }
  for (const e of match.watchEvents.slice(0, 1)) {
    signals.push({
      category: "事件", indicator: `${e.category}关注`, value: e.title,
      judgment: e.reason, bullish: false, weight: 0,
    });
  }

  return { score: match.netImpact, signals };
}
