// 东方财富 API 数据获取

export interface StockQuote {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;       // 成交量（手）
  amount: number;       // 成交额（元）
  open: number;
  high: number;
  low: number;
  prevClose: number;
  turnoverRate: number; // 换手率
  pe: number;           // 市盈率
  marketCap: number;    // 总市值
}

export interface SectorData {
  code: string;
  name: string;
  change: number;
  changePercent: number;
  volume: number;
  amount: number;
  leadingStock: string;
  leadingStockChange: number;
  stockCount: number;
  riseCount: number;
  fallCount: number;
}

export interface EnrichedSectorData extends SectorData {
  open: number;
  high: number;
  low: number;
  prevClose: number;
  turnoverRate: number;
  amplitude: number;           // 振幅%
  change5d: number;            // 5日涨跌幅%
  change10d: number;           // 10日涨跌幅%
  mainNetInflow: number;       // 主力净流入（元）
  mainNetInflowPercent: number; // 主力净流入占比%
  leadingStockCode: string;    // 领涨股代码
}

export interface KLineData {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
}

export interface MarketOverview {
  shIndex: { price: number; change: number; changePercent: number; volume: number; amount: number };
  szIndex: { price: number; change: number; changePercent: number; volume: number; amount: number };
  cybIndex: { price: number; change: number; changePercent: number; volume: number; amount: number };
  riseCount: number;
  fallCount: number;
  flatCount: number;
  limitUp: number;
  limitDown: number;
}

// 获取A股实时行情列表（东方财富）
export async function fetchStockList(page = 1, pageSize = 20): Promise<StockQuote[]> {
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f14,f15,f16,f17,f18`;

  const resp = await fetch(url, {
    headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 10 },
  });
  const json = await resp.json();

  if (!json.data?.diff) return [];

  return json.data.diff.map((item: Record<string, number | string>) => ({
    code: String(item.f12),
    name: String(item.f14),
    price: Number(item.f2) || 0,
    change: Number(item.f4) || 0,
    changePercent: Number(item.f3) || 0,
    volume: Number(item.f5) || 0,
    amount: Number(item.f6) || 0,
    open: Number(item.f17) || 0,
    high: Number(item.f15) || 0,
    low: Number(item.f16) || 0,
    prevClose: Number(item.f18) || 0,
    turnoverRate: Number(item.f8) || 0,
    pe: Number(item.f9) || 0,
    marketCap: Number(item.f7) || 0,
  }));
}

// 获取涨幅排序前500只个股（涵盖3%+的票，用于涨停预判）
export async function fetchNearLimitUpStocks(): Promise<StockQuote[]> {
  // fid=f3 + po=1 = 按涨幅降序排列，取500只覆盖3%+
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=500&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f14,f15,f16,f17,f18`;

  const resp = await fetch(url, {
    headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 5 }, // 5秒缓存，更快
  });
  const json = await resp.json();
  if (!json.data?.diff) return [];

  return json.data.diff.map((item: Record<string, number | string>) => ({
    code: String(item.f12),
    name: String(item.f14),
    price: Number(item.f2) || 0,
    change: Number(item.f4) || 0,
    changePercent: Number(item.f3) || 0,
    volume: Number(item.f5) || 0,
    amount: Number(item.f6) || 0,
    open: Number(item.f17) || 0,
    high: Number(item.f15) || 0,
    low: Number(item.f16) || 0,
    prevClose: Number(item.f18) || 0,
    turnoverRate: Number(item.f8) || 0,
    pe: Number(item.f9) || 0,
    marketCap: Number(item.f7) || 0,
  }));
}

// 获取板块行情（东方财富行业板块）
export async function fetchSectorList(): Promise<SectorData[]> {
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=50&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f2,f3,f4,f8,f12,f14,f104,f105,f128,f136,f140,f141`;

  const resp = await fetch(url, {
    headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 10 },
  });
  const json = await resp.json();

  if (!json.data?.diff) return [];

  return json.data.diff.map((item: Record<string, number | string>) => ({
    code: String(item.f12),
    name: String(item.f14),
    change: Number(item.f4) || 0,
    changePercent: Number(item.f3) || 0,
    volume: Number(item.f136) || 0,
    amount: Number(item.f8) || 0,
    leadingStock: String(item.f140 || ""),
    leadingStockChange: Number(item.f141) || 0,
    stockCount: (Number(item.f104) || 0) + (Number(item.f105) || 0),
    riseCount: Number(item.f104) || 0,
    fallCount: Number(item.f105) || 0,
  }));
}

// 获取富含信息的板块数据（含5d/10d涨幅、资金流、换手率等）
// 同时获取行业板块(t:2)和概念板块(t:3)以提高ETF匹配率
export async function fetchEnrichedSectorList(): Promise<EnrichedSectorData[]> {
  const fields = "f2,f3,f4,f6,f7,f8,f12,f14,f15,f16,f17,f18,f20,f24,f25,f62,f104,f105,f128,f136,f140,f141,f184";
  const urls = [
    `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=${fields}`,
    `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:3&fields=${fields}`,
  ];
  const headers = { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" };
  const results = await Promise.all(urls.map(url =>
    fetch(url, { headers, next: { revalidate: 10 } }).then(r => r.json()).catch(() => null)
  ));
  const allItems: EnrichedSectorData[] = [];
  const seen = new Set<string>();
  for (const json of results) {
    if (!json?.data?.diff) continue;
    for (const item of json.data.diff) {
      const code = String(item.f12);
      if (seen.has(code)) continue;
      seen.add(code);
      allItems.push(parseEnrichedSector(item));
    }
  }
  return allItems;
}

function parseEnrichedSector(item: Record<string, number | string>): EnrichedSectorData {
  return {
    code: String(item.f12),
    name: String(item.f14),
    change: Number(item.f4) || 0,
    changePercent: Number(item.f3) || 0,
    volume: Number(item.f136) || 0,
    amount: Number(item.f6) || 0,
    leadingStock: String(item.f128 || ""),
    leadingStockChange: 0,
    stockCount: (Number(item.f104) || 0) + (Number(item.f105) || 0),
    riseCount: Number(item.f104) || 0,
    fallCount: Number(item.f105) || 0,
    open: Number(item.f17) || 0,
    high: Number(item.f15) || 0,
    low: Number(item.f16) || 0,
    prevClose: Number(item.f18) || 0,
    turnoverRate: Number(item.f8) || 0,
    amplitude: Number(item.f7) || 0,
    change5d: Number(item.f24) || 0,
    change10d: Number(item.f25) || 0,
    mainNetInflow: Number(item.f62) || 0,
    mainNetInflowPercent: Number(item.f184) || 0,
    leadingStockCode: String(item.f140 || ""),
  };
}

// 获取个股K线数据（日K）
export async function fetchKLine(code: string, market?: number, days: number = 120): Promise<KLineData[]> {
  // market: 0=深圳 1=上海，根据代码前缀自动判断
  const m = market !== undefined ? market : (code.startsWith("6") ? 1 : 0);
  const secid = `${m}.${code}`;
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=${days}`;

  const resp = await fetch(url, {
    headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 60 },
  });
  const json = await resp.json();

  if (!json.data?.klines) return [];

  return json.data.klines.map((line: string) => {
    const parts = line.split(",");
    return {
      date: parts[0],
      open: parseFloat(parts[1]),
      close: parseFloat(parts[2]),
      high: parseFloat(parts[3]),
      low: parseFloat(parts[4]),
      volume: parseFloat(parts[5]),
      amount: parseFloat(parts[6]),
    };
  });
}

// 获取大盘指数
export async function fetchMarketOverview(): Promise<MarketOverview> {
  // 上证指数 1.000001, 深证成指 0.399001, 创业板指 0.399006
  const indices = ["1.000001", "0.399001", "0.399006"];
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f4,f6,f104,f105&secids=${indices.join(",")}`;

  const resp = await fetch(url, {
    headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 10 },
  });
  const json = await resp.json();

  const list = json.data?.diff || [];
  const parse = (idx: number) => ({
    price: Number(list[idx]?.f2) || 0,
    change: Number(list[idx]?.f4) || 0,
    changePercent: Number(list[idx]?.f3) || 0,
    volume: Number(list[idx]?.f104) || 0,
    amount: Number(list[idx]?.f6) || 0,
  });

  // 获取涨跌家数
  const statsUrl = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=1&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f3&stat=1`;
  let riseCount = 0, fallCount = 0, flatCount = 0;
  try {
    const statsResp = await fetch(statsUrl, {
      headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 30 },
    });
    const statsJson = await statsResp.json();
    riseCount = statsJson.data?.total || 0;
  } catch {}

  return {
    shIndex: parse(0),
    szIndex: parse(1),
    cybIndex: parse(2),
    riseCount,
    fallCount,
    flatCount,
    limitUp: 0,
    limitDown: 0,
  };
}

// 搜索股票 - 使用东方财富搜索API
export async function searchStock(keyword: string): Promise<{ code: string; name: string; market: number }[]> {
  // 方法1: 东方财富专用搜索接口
  try {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10`;
    const resp = await fetch(url, {
      headers: { "Referer": "https://so.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
    });
    const json = await resp.json();
    if (json.QuotationCodeTable?.Data) {
      const results = json.QuotationCodeTable.Data
        .filter((item: Record<string, string>) => {
          const mkt = String(item.MktNum);
          // 只要A股（深圳0、上海1）
          return mkt === "0" || mkt === "1";
        })
        .slice(0, 10)
        .map((item: Record<string, string>) => ({
          code: String(item.Code),
          name: String(item.Name),
          market: String(item.MktNum) === "1" ? 1 : 0,
        }));
      if (results.length > 0) return results;
    }
  } catch {}

  // 方法2: 全量列表过滤（备用）
  try {
    const allUrl = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5500&po=1&np=1&fltt=2&invt=2&fid=f12&fs=m:0+t:6,m:0+t:13,m:0+t:80,m:1+t:2,m:1+t:23&fields=f12,f14`;
    const resp = await fetch(allUrl, {
      headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
    });
    const json = await resp.json();
    if (!json.data?.diff) return [];
    return json.data.diff
      .filter((item: Record<string, string | number>) => {
        const code = String(item.f12);
        const name = String(item.f14);
        return code.includes(keyword) || name.toLowerCase().includes(keyword.toLowerCase());
      })
      .slice(0, 10)
      .map((item: Record<string, string | number>) => ({
        code: String(item.f12),
        name: String(item.f14),
        market: String(item.f12).startsWith("6") ? 1 : 0,
      }));
  } catch {
    return [];
  }
}

// ==================== 美股 & 国际市场数据 ====================

export interface GlobalIndexData {
  name: string;
  code: string;
  price: number;
  change: number;
  changePercent: number;
}

// 获取全球主要指数（美股三大指数 + 欧洲 + 亚太）
export async function fetchGlobalIndices(): Promise<GlobalIndexData[]> {
  // 道琼斯 105.DJIA, 纳斯达克 105.NDX, 标普500 105.SPX
  // 恒生 116.HSI, 日经 117.NI225, 英国FTSE 153.FTSE, 德国DAX 155.DAX
  const secids = "105.DJIA,105.NDX,105.SPX,100.HSI,100.N225,100.FTSE,100.GDAXI";
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f4,f14&secids=${secids}`;

  try {
    const resp = await fetch(url, {
      headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 30 },
    });
    const json = await resp.json();
    const list = json.data?.diff || [];
    const names = ["道琼斯", "纳斯达克", "标普500", "恒生指数", "日经225", "英国富时100", "德国DAX"];
    const codes = ["DJIA", "NDX", "SPX", "HSI", "N225", "FTSE", "DAX"];

    return list.map((item: Record<string, number | string>, i: number) => ({
      name: names[i] || String(item.f14 || ""),
      code: codes[i] || "",
      price: Number(item.f2) || 0,
      change: Number(item.f4) || 0,
      changePercent: Number(item.f3) || 0,
    }));
  } catch {
    return [];
  }
}

// ==================== ETF 板块数据 ====================

export interface ETFData {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  amount: number;
  turnoverRate: number;
  sector: string;        // 所属板块
  amplitude: number;     // 振幅%
  change5d: number;      // 5日涨跌幅%
  change10d: number;     // 10日涨跌幅%
  mainNetInflow: number; // 主力净流入（元）
}

// 主要板块ETF列表 — 代码与板块映射（全面覆盖各细分方向）
export const SECTOR_ETF_MAP: Record<string, { code: string; name: string; secid: string }[]> = {
  // ===== 科技 =====
  "半导体芯片": [
    { code: "512480", name: "半导体ETF", secid: "1.512480" },
    { code: "159801", name: "芯片ETF", secid: "0.159801" },
  ],
  "人工智能": [
    { code: "515070", name: "人工智能ETF", secid: "1.515070" },
    { code: "159890", name: "云计算ETF", secid: "0.159890" },
  ],
  "通信5G": [
    { code: "515880", name: "通信ETF", secid: "1.515880" },
    { code: "515050", name: "5GETF", secid: "1.515050" },
  ],
  "军工": [
    { code: "512660", name: "军工ETF", secid: "1.512660" },
  ],
  "游戏传媒": [
    { code: "159869", name: "游戏ETF", secid: "0.159869" },
  ],
  // ===== 新能源 =====
  "新能源车": [
    { code: "515030", name: "新能源车ETF", secid: "1.515030" },
    { code: "159755", name: "电池ETF", secid: "0.159755" },
    { code: "516110", name: "汽车ETF", secid: "1.516110" },
  ],
  "光伏风电": [
    { code: "515790", name: "光伏ETF", secid: "1.515790" },
    { code: "516160", name: "新能源ETF", secid: "1.516160" },
  ],
  "电力能源": [
    { code: "159611", name: "电力ETF", secid: "0.159611" },
    { code: "159790", name: "碳中和ETF", secid: "0.159790" },
  ],
  // ===== 消费 =====
  "食品饮料": [
    { code: "515170", name: "食品饮料ETF", secid: "1.515170" },
    { code: "512690", name: "酒ETF", secid: "1.512690" },
  ],
  "大消费": [
    { code: "159928", name: "消费ETF", secid: "0.159928" },
    { code: "515650", name: "消费50ETF", secid: "1.515650" },
  ],
  "家电": [
    { code: "159996", name: "家电ETF", secid: "0.159996" },
  ],
  "旅游": [
    { code: "159766", name: "旅游ETF", secid: "0.159766" },
  ],
  "农业": [
    { code: "159825", name: "农业ETF", secid: "0.159825" },
  ],
  // ===== 金融地产 =====
  "银行": [
    { code: "512800", name: "银行ETF", secid: "1.512800" },
  ],
  "券商": [
    { code: "512000", name: "券商ETF", secid: "1.512000" },
    { code: "159841", name: "证券ETF", secid: "0.159841" },
  ],
  "保险": [
    { code: "512070", name: "非银金融ETF", secid: "1.512070" },
  ],
  "房地产": [
    { code: "512200", name: "房地产ETF", secid: "1.512200" },
  ],
  // ===== 医药 =====
  "医药综合": [
    { code: "512010", name: "医药ETF", secid: "1.512010" },
    { code: "159938", name: "医药ETF广发", secid: "0.159938" },
  ],
  "创新药": [
    { code: "159992", name: "创新药ETF", secid: "0.159992" },
  ],
  "医疗器械": [
    { code: "516820", name: "医疗器械ETF", secid: "1.516820" },
    { code: "512170", name: "医疗ETF", secid: "1.512170" },
  ],
  // ===== 周期资源 =====
  "煤炭": [
    { code: "515220", name: "煤炭ETF", secid: "1.515220" },
  ],
  "有色金属": [
    { code: "512400", name: "有色金属ETF", secid: "1.512400" },
    { code: "562800", name: "稀有金属ETF", secid: "1.562800" },
    { code: "516780", name: "稀土ETF", secid: "1.516780" },
  ],
  "商品": [
    { code: "159985", name: "豆粕ETF", secid: "0.159985" },
  ],
  "建材基建": [
    { code: "159745", name: "建材ETF", secid: "0.159745" },
    { code: "516950", name: "基建ETF", secid: "1.516950" },
  ],
  "环保": [
    { code: "512580", name: "环保ETF", secid: "1.512580" },
  ],
  // ===== 红利高股息 =====
  "红利策略": [
    { code: "510880", name: "红利ETF", secid: "1.510880" },
    { code: "515180", name: "红利ETF易方达", secid: "1.515180" },
    { code: "512890", name: "红利低波ETF", secid: "1.512890" },
  ],
  // ===== 宽基指数 =====
  "沪深300": [
    { code: "510300", name: "沪深300ETF", secid: "1.510300" },
  ],
  "中证500": [
    { code: "510500", name: "中证500ETF", secid: "1.510500" },
  ],
  "中证1000": [
    { code: "512100", name: "中证1000ETF", secid: "1.512100" },
  ],
  "上证50": [
    { code: "510050", name: "上证50ETF", secid: "1.510050" },
  ],
  "创业板": [
    { code: "159915", name: "创业板ETF", secid: "0.159915" },
  ],
  "科创板": [
    { code: "588000", name: "科创50ETF", secid: "1.588000" },
    { code: "588080", name: "科创50ETF易方达", secid: "1.588080" },
  ],
  // ===== 跨境 =====
  "港股": [
    { code: "159920", name: "恒生ETF", secid: "0.159920" },
    { code: "513050", name: "中概互联网ETF", secid: "1.513050" },
  ],
  "美股": [
    { code: "159509", name: "纳指科技ETF", secid: "0.159509" },
  ],
  "MSCI": [
    { code: "512160", name: "MSCI中国ETF", secid: "1.512160" },
  ],
};

// ==================== 场外联接基金（C类） ====================

export const OTC_FUND_MAP: Record<string, { code: string; name: string }[]> = {
  // ===== 科技 =====
  "半导体芯片": [
    { code: "012540", name: "国泰半导体ETF联接C" },
    { code: "017470", name: "嘉实科创芯片ETF联接C" },
  ],
  "人工智能": [
    { code: "014301", name: "华夏人工智能ETF联接C" },
    { code: "013850", name: "天弘中证云计算与大数据C" },
  ],
  "通信5G": [
    { code: "008313", name: "华夏中证5GETF联接C" },
  ],
  "军工": [
    { code: "012487", name: "国泰军工ETF联接C" },
  ],
  "游戏传媒": [
    { code: "012727", name: "华夏游戏ETF联接C" },
  ],
  // ===== 新能源 =====
  "新能源车": [
    { code: "013015", name: "华夏新能源车ETF联接C" },
    { code: "013853", name: "天弘国证新能源车C" },
  ],
  "光伏风电": [
    { code: "014555", name: "华泰柏瑞光伏ETF联接C" },
  ],
  "电力能源": [
    { code: "017870", name: "广发电力ETF联接C" },
  ],
  // ===== 消费 =====
  "食品饮料": [
    { code: "012858", name: "华夏食品饮料ETF联接C" },
  ],
  "大消费": [
    { code: "008929", name: "汇添富消费ETF联接C" },
  ],
  "家电": [
    { code: "013398", name: "国泰家电ETF联接C" },
  ],
  "旅游": [
    { code: "018634", name: "富国旅游ETF联接C" },
  ],
  "农业": [
    { code: "015853", name: "富国农业ETF联接C" },
  ],
  // ===== 金融地产 =====
  "银行": [
    { code: "007153", name: "华宝银行ETF联接C" },
  ],
  "券商": [
    { code: "007532", name: "华宝券商ETF联接C" },
  ],
  "保险": [
    { code: "012860", name: "天弘中证证保ETF联接C" },
  ],
  "房地产": [
    { code: "008087", name: "南方房地产ETF联接C" },
  ],
  // ===== 医药 =====
  "医药综合": [
    { code: "008764", name: "易方达医药ETF联接C" },
  ],
  "创新药": [
    { code: "012738", name: "广发创新药ETF联接C" },
    { code: "014118", name: "国泰创新药ETF联接C" },
  ],
  "医疗器械": [
    { code: "013416", name: "国泰医疗器械ETF联接C" },
  ],
  // ===== 周期资源 =====
  "煤炭": [
    { code: "015897", name: "国泰煤炭ETF联接C" },
  ],
  "有色金属": [
    { code: "019875", name: "广发稀有金属ETF联接C" },
    { code: "014833", name: "华泰柏瑞稀土ETF联接C" },
  ],
  "商品": [
    { code: "012810", name: "华夏豆粕ETF联接C" },
  ],
  "建材基建": [
    { code: "013301", name: "国泰建材ETF联接C" },
  ],
  "环保": [
    { code: "012530", name: "广发环保ETF联接C" },
  ],
  // ===== 红利高股息 =====
  "红利策略": [
    { code: "012761", name: "华泰柏瑞红利ETF联接C" },
    { code: "013607", name: "华泰柏瑞红利低波ETF联接C" },
  ],
  // ===== 宽基指数 =====
  "沪深300": [
    { code: "007340", name: "华泰柏瑞沪深300ETF联接C" },
  ],
  "中证500": [
    { code: "007029", name: "南方中证500ETF联接C" },
  ],
  "中证1000": [
    { code: "014068", name: "南方中证1000ETF联接C" },
  ],
  "上证50": [
    { code: "005733", name: "华夏上证50ETF联接C" },
  ],
  "创业板": [
    { code: "007465", name: "易方达创业板ETF联接C" },
  ],
  "科创板": [
    { code: "011609", name: "华夏科创50ETF联接C" },
  ],
  // ===== 跨境 =====
  "港股": [
    { code: "012349", name: "天弘恒生科技ETF联接C" },
    { code: "006328", name: "易方达中概互联ETF联接C" },
  ],
  "美股": [
    { code: "019548", name: "景顺纳指科技ETF联接C" },
  ],
  // ===== 化工 =====
  "化工": [
    { code: "020274", name: "富国细分化工ETF联接C" },
  ],
};

// 场外联接基金净值数据
export interface OTCFundData {
  code: string;
  name: string;
  nav: number;           // 最新净值
  navDate: string;       // 净值日期
  navChangePercent: number; // 净值日涨跌幅%
  estimatedChange: number | null; // 盘中实时估值涨跌幅%（非交易时null）
  change5d: number;      // 5日涨跌幅%
  change10d: number;     // 10日涨跌幅%
  sector: string;        // 所属板块
}

// 获取场外联接基金净值+历史净值（算5d/10d涨幅）
export async function fetchOTCFundList(): Promise<OTCFundData[]> {
  const allFunds: { code: string; name: string; sector: string }[] = [];
  for (const [sector, funds] of Object.entries(OTC_FUND_MAP)) {
    for (const fund of funds) {
      if (!allFunds.find(f => f.code === fund.code)) {
        allFunds.push({ ...fund, sector });
      }
    }
  }

  const codes = allFunds.map(f => f.code).join(",");

  try {
    // 1. 批量获取最新净值
    const navResp = await fetch(
      `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=1&pageSize=100&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=1&Fcodes=${codes}`,
      { headers: { "Referer": "https://fund.eastmoney.com/" }, next: { revalidate: 60 } }
    );
    const navJson = await navResp.json();
    const navMap: Record<string, { nav: number; date: string; chg: number; gszzl: number | null }> = {};
    for (const d of navJson.Datas || []) {
      navMap[d.FCODE] = {
        nav: parseFloat(d.NAV) || 0,
        date: d.PDATE || "",
        chg: parseFloat(d.NAVCHGRT) || 0,
        gszzl: d.GSZZL != null && d.GSZZL !== "" ? parseFloat(d.GSZZL) : null,
      };
    }

    // 2. 并发获取每只基金的历史净值（取15条够算5d/10d）
    const histResults = await Promise.allSettled(
      allFunds.map(f =>
        fetch(
          `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${f.code}&pageIndex=1&pageSize=15`,
          { headers: { "Referer": "https://fund.eastmoney.com/" }, next: { revalidate: 300 } }
        ).then(r => r.json()).then(j => ({
          code: f.code,
          navs: (j.Data?.LSJZList || []).map((d: Record<string, string>) => parseFloat(d.DWJZ)).reverse() as number[]
        }))
      )
    );

    const histMap: Record<string, number[]> = {};
    for (const r of histResults) {
      if (r.status === "fulfilled") histMap[r.value.code] = r.value.navs;
    }

    return allFunds.map(f => {
      const info = navMap[f.code];
      const navs = histMap[f.code] || [];
      const len = navs.length;
      const latestNav = info?.nav || (len > 0 ? navs[len - 1] : 0);

      let change5d = 0, change10d = 0;
      if (len >= 6) change5d = ((navs[len - 1] - navs[len - 6]) / navs[len - 6]) * 100;
      if (len >= 11) change10d = ((navs[len - 1] - navs[len - 11]) / navs[len - 11]) * 100;

      return {
        code: f.code,
        name: info ? f.name : f.name,
        nav: latestNav,
        navDate: info?.date || "",
        navChangePercent: info?.chg || 0,
        estimatedChange: info?.gszzl ?? null,
        change5d,
        change10d,
        sector: f.sector,
      };
    });
  } catch {
    return [];
  }
}

// 获取ETF实时行情
export async function fetchETFList(): Promise<ETFData[]> {
  // 获取所有ETF的secid
  const allETFs: { code: string; name: string; secid: string; sector: string }[] = [];
  for (const [sector, etfs] of Object.entries(SECTOR_ETF_MAP)) {
    for (const etf of etfs) {
      if (!allETFs.find(e => e.code === etf.code)) {
        allETFs.push({ ...etf, sector });
      }
    }
  }

  const secids = allETFs.map(e => e.secid).join(",");
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f4,f5,f6,f7,f8,f12,f14,f24,f25,f62&secids=${secids}`;

  try {
    const resp = await fetch(url, {
      headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 10 },
    });
    const json = await resp.json();
    const list = json.data?.diff || [];

    return list.map((item: Record<string, number | string>, i: number) => ({
      code: String(item.f12 || allETFs[i]?.code),
      name: String(item.f14 || allETFs[i]?.name),
      price: Number(item.f2) || 0,
      change: Number(item.f4) || 0,
      changePercent: Number(item.f3) || 0,
      volume: Number(item.f5) || 0,
      amount: Number(item.f6) || 0,
      turnoverRate: Number(item.f8) || 0,
      sector: allETFs[i]?.sector || "",
      amplitude: Number(item.f7) || 0,
      change5d: Number(item.f24) || 0,
      change10d: Number(item.f25) || 0,
      mainNetInflow: Number(item.f62) || 0,
    }));
  } catch {
    return [];
  }
}

// 获取ETF的K线数据
export async function fetchETFKLine(code: string, days = 120): Promise<KLineData[]> {
  const m = code.startsWith("1") || code.startsWith("5") ? 1 : 0;
  return fetchKLine(code, m, days);
}

// ==================== 资金流向数据 ====================

export interface NorthboundFlow {
  date: string;
  shConnect: number;    // 沪股通净买入（万元）
  szConnect: number;    // 深股通净买入（万元）
  total: number;        // 合计
}

// 获取北向资金最近N天流向
export async function fetchNorthboundFlow(days = 10): Promise<NorthboundFlow[]> {
  const url = `https://push2his.eastmoney.com/api/qt/kamt.kline/get?fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55&klt=101&lmt=${days}`;
  try {
    const resp = await fetch(url, {
      headers: { "Referer": "https://data.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 60 },
    });
    const json = await resp.json();
    const lines = json.data?.s2n || [];
    return lines.map((line: string) => {
      const p = line.split(",");
      return {
        date: p[0],
        shConnect: parseFloat(p[1]) || 0,
        szConnect: parseFloat(p[2]) || 0,
        total: parseFloat(p[3]) || 0,
      };
    });
  } catch {
    return [];
  }
}

export interface SectorMoneyFlow {
  code: string;
  name: string;
  mainNetInflow: number;      // 主力净流入（元）
  superNetInflow: number;     // 超大单净流入
  bigNetInflow: number;       // 大单净流入
  midNetInflow: number;       // 中单净流入
  smallNetInflow: number;     // 小单净流入
  mainNetInflowPercent: number; // 主力净流入占比%
}

// 获取板块主力资金流向
export async function fetchSectorMoneyFlow(): Promise<SectorMoneyFlow[]> {
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=50&po=1&np=1&fltt=2&invt=2&fid=f62&fs=m:90+t:2&fields=f12,f14,f62,f66,f69,f72,f75,f78,f184`;
  try {
    const resp = await fetch(url, {
      headers: { "Referer": "https://data.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 30 },
    });
    const json = await resp.json();
    if (!json.data?.diff) return [];
    return json.data.diff.map((item: Record<string, number | string>) => ({
      code: String(item.f12),
      name: String(item.f14),
      mainNetInflow: Number(item.f62) || 0,
      superNetInflow: Number(item.f66) || 0,
      bigNetInflow: Number(item.f72) || 0,
      midNetInflow: Number(item.f78) || 0,
      smallNetInflow: Number(item.f75) || 0,
      mainNetInflowPercent: Number(item.f184) || 0,
    }));
  } catch {
    return [];
  }
}

// 获取个股/板块的拥挤度指标（成交额占比、换手率）
export interface CrowdingData {
  sectorName: string;
  turnoverRate: number;           // 换手率
  amountRatio: number;            // 成交额占全市场比例
  pePercentile: number;           // PE分位（估算）
}

// 获取板块成交额占比（用于拥挤度判断）
export async function fetchSectorCrowding(sectors: SectorData[], totalMarketAmount: number): Promise<CrowdingData[]> {
  return sectors.map(s => ({
    sectorName: s.name,
    turnoverRate: 0,
    amountRatio: totalMarketAmount > 0 ? (s.amount / totalMarketAmount) * 100 : 0,
    pePercentile: 0,
  }));
}

// ==================== 情绪面数据 ====================

export interface MarketSentimentData {
  limitUp: number;          // 涨停家数
  limitDown: number;        // 跌停家数
  riseCount: number;        // 上涨家数
  fallCount: number;        // 下跌家数
  flatCount: number;        // 平盘家数
  rise5pct: number;         // 涨幅>5%家数
  fall5pct: number;         // 跌幅>5%家数
  rise7pct: number;         // 涨幅>7%（准涨停）
  fall7pct: number;         // 跌幅>7%（准跌停）
  avgChangePercent: number; // 全市场平均涨跌幅
  medianChange: number;     // 中位数涨跌幅
  maxGain: { code: string; name: string; change: number };
  maxLoss: { code: string; name: string; change: number };
}

// 获取全市场情绪面细节（涨停/跌停/涨5%以上/跌5%以上/中位数等）
export async function fetchMarketSentimentData(): Promise<MarketSentimentData> {
  const defaults: MarketSentimentData = {
    limitUp: 0, limitDown: 0,
    riseCount: 0, fallCount: 0, flatCount: 0,
    rise5pct: 0, fall5pct: 0, rise7pct: 0, fall7pct: 0,
    avgChangePercent: 0, medianChange: 0,
    maxGain: { code: "", name: "", change: 0 },
    maxLoss: { code: "", name: "", change: 0 },
  };
  try {
    // 获取全市场股票的涨跌幅（取前5000只，覆盖全市场）
    const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5500&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f3,f12,f14`;
    const resp = await fetch(url, {
      headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 30 },
    });
    const json = await resp.json();
    const items = json.data?.diff || [];

    const changes: number[] = [];
    let limitUp = 0, limitDown = 0;
    let riseCount = 0, fallCount = 0, flatCount = 0;
    let rise5 = 0, fall5 = 0, rise7 = 0, fall7 = 0;
    let maxG = { code: "", name: "", change: -999 };
    let maxL = { code: "", name: "", change: 999 };

    for (const item of items) {
      const chg = Number(item.f3);
      if (isNaN(chg)) continue;
      changes.push(chg);

      if (chg > 0) riseCount++;
      else if (chg < 0) fallCount++;
      else flatCount++;

      if (chg >= 9.9) limitUp++;
      if (chg <= -9.9) limitDown++;
      if (chg >= 5) rise5++;
      if (chg <= -5) fall5++;
      if (chg >= 7) rise7++;
      if (chg <= -7) fall7++;

      if (chg > maxG.change) maxG = { code: String(item.f12), name: String(item.f14), change: chg };
      if (chg < maxL.change) maxL = { code: String(item.f12), name: String(item.f14), change: chg };
    }

    changes.sort((a, b) => a - b);
    const avg = changes.length > 0 ? changes.reduce((s, v) => s + v, 0) / changes.length : 0;
    const median = changes.length > 0 ? changes[Math.floor(changes.length / 2)] : 0;

    return {
      limitUp, limitDown,
      riseCount, fallCount, flatCount,
      rise5pct: rise5, fall5pct: fall5, rise7pct: rise7, fall7pct: fall7,
      avgChangePercent: Math.round(avg * 100) / 100,
      medianChange: Math.round(median * 100) / 100,
      maxGain: maxG, maxLoss: maxL,
    };
  } catch {
    return defaults;
  }
}

// ==================== 增强数据：多日资金流趋势 ====================

export interface MultiDayMoneyFlow {
  sectorName: string;
  daily: { date: string; mainNetInflow: number; superNetInflow: number }[];
  trend3d: number;    // 近3日主力净流入合计（万）
  trend5d: number;    // 近5日主力净流入合计（万）
  momentum: number;   // 加速度：近2日-前3日
}

// 获取板块多日资金流向（通过K线方式取最近10日数据）
export async function fetchSectorMoneyFlowTrend(sectorCode: string, days = 10): Promise<MultiDayMoneyFlow> {
  const defaults: MultiDayMoneyFlow = { sectorName: "", daily: [], trend3d: 0, trend5d: 0, momentum: 0 };
  try {
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=90.${sectorCode}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=${days}`;
    const resp = await fetch(url, {
      headers: { "Referer": "https://data.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 120 },
    });
    const json = await resp.json();
    const name = json.data?.name || "";
    const klines = json.data?.klines || [];

    const daily = klines.map((line: string) => {
      const p = line.split(",");
      return { date: p[0], mainNetInflow: parseFloat(p[5]) || 0, superNetInflow: parseFloat(p[6]) || 0 };
    });

    const last5 = daily.slice(-5);
    const last3 = daily.slice(-3);
    const trend5 = last5.reduce((s: number, d: { mainNetInflow: number }) => s + d.mainNetInflow, 0) / 10000;
    const trend3 = last3.reduce((s: number, d: { mainNetInflow: number }) => s + d.mainNetInflow, 0) / 10000;
    const recent2 = daily.slice(-2).reduce((s: number, d: { mainNetInflow: number }) => s + d.mainNetInflow, 0) / 10000;
    const prev3 = daily.slice(-5, -2).reduce((s: number, d: { mainNetInflow: number }) => s + d.mainNetInflow, 0) / 10000;

    return { sectorName: name, daily, trend3d: round(trend3), trend5d: round(trend5), momentum: round(recent2 - prev3) };
  } catch {
    return defaults;
  }
}

// 获取融资融券余额（全市场，通过东方财富数据中心）
export interface MarginData {
  date: string;
  marginBalance: number;       // 融资余额（亿）
  shortBalance: number;        // 融券余额（亿）
  marginBuy: number;           // 融资买入额（亿）
  marginRepay: number;         // 融资偿还额（亿）
  netMarginBuy: number;        // 融资净买入（亿）
  marginBalanceChange: number; // 融资余额较上日变化（亿）
}

export async function fetchMarginData(days = 10): Promise<MarginData[]> {
  try {
    const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_RZRQ_LSHJ&columns=ALL&sortColumns=DIM_DATE&sortTypes=-1&pageSize=${days}&pageNumber=1&source=WEB&client=WEBALL`;
    const resp = await fetch(url, {
      headers: { "Referer": "https://data.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 300 },
    });
    const json = await resp.json();
    const items = json.result?.data || [];
    return items.map((item: Record<string, string | number>) => ({
      date: String(item.DIM_DATE || "").slice(0, 10),
      marginBalance: (Number(item.RZYE) || 0) / 1e8,
      shortBalance: (Number(item.RQYE) || 0) / 1e8,
      marginBuy: (Number(item.RZMRE) || 0) / 1e8,
      marginRepay: (Number(item.RZCHE) || 0) / 1e8,
      netMarginBuy: (Number(item.RZJME) || 0) / 1e8,
      marginBalanceChange: 0,
    })).map((d: MarginData, i: number, arr: MarginData[]) => ({
      ...d,
      marginBalanceChange: i < arr.length - 1 ? round(d.marginBalance - arr[i + 1].marginBalance) : 0,
    }));
  } catch {
    return [];
  }
}

// ==================== 增强数据：市场情绪深度指标 ====================

export interface MarketBreadthData {
  limitUp: number;
  limitDown: number;
  continuousLimitUp: number;     // 连板股数量（2板以上）
  maxContinuousBoard: number;    // 最高连板数
  upDownRatio: number;           // 涨跌比（>1偏多, <1偏空）
  totalAmount: number;           // 全市场成交额（亿）
  amountMA5: number;             // 5日均成交额（亿）
  amountPercentile: number;      // 成交额在历史中的分位 0-100
  strongStockRatio: number;      // 强势股占比（涨>3%）%
  weakStockRatio: number;        // 弱势股占比（跌>3%）%
  sentimentScore: number;        // 综合情绪分 -100~100
}

export async function fetchMarketBreadth(): Promise<MarketBreadthData> {
  const defaults: MarketBreadthData = {
    limitUp: 0, limitDown: 0, continuousLimitUp: 0, maxContinuousBoard: 0,
    upDownRatio: 1, totalAmount: 0, amountMA5: 0, amountPercentile: 50,
    strongStockRatio: 0, weakStockRatio: 0, sentimentScore: 0,
  };
  try {
    // 1. 全市场涨跌统计
    const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5500&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:13,m:0+t:80,m:1+t:2,m:1+t:23&fields=f3,f6,f12,f14`;
    const resp = await fetch(url, {
      headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 30 },
    });
    const json = await resp.json();
    const items = json.data?.diff || [];

    let limitUp = 0, limitDown = 0, riseCount = 0, fallCount = 0;
    let strong = 0, weak = 0, totalAmount = 0;

    for (const item of items) {
      const chg = Number(item.f3);
      const amt = Number(item.f6) || 0;
      totalAmount += amt;
      if (isNaN(chg)) continue;
      if (chg > 0) riseCount++;
      if (chg < 0) fallCount++;
      if (chg >= 9.9) limitUp++;
      if (chg <= -9.9) limitDown++;
      if (chg >= 3) strong++;
      if (chg <= -3) weak++;
    }

    const total = items.length || 1;
    const upDownRatio = fallCount > 0 ? round(riseCount / fallCount) : riseCount > 0 ? 10 : 1;
    const totalAmountYi = round(totalAmount / 1e8);
    const strongRatio = round((strong / total) * 100);
    const weakRatio = round((weak / total) * 100);

    // 2. 连板统计（涨停+昨日也涨停 → 通过涨停板数量近似）
    // 简化：涨停数量>30为热，<10为冷
    const continuousLimitUp = Math.max(0, limitUp - 15); // 近似连板数
    const maxContinuousBoard = limitUp >= 30 ? 5 : limitUp >= 20 ? 4 : limitUp >= 10 ? 3 : 2;

    // 3. 成交额分位估算（万亿为中位数，1.5万亿为高）
    const amountPercentile = totalAmountYi >= 15000 ? 90
      : totalAmountYi >= 12000 ? 75
      : totalAmountYi >= 10000 ? 50
      : totalAmountYi >= 8000 ? 30
      : totalAmountYi >= 6000 ? 15
      : 5;

    // 4. 综合情绪分
    const sentimentScore = clampValue(
      (upDownRatio - 1) * 15                    // 涨跌比贡献
      + (limitUp - limitDown) * 1.5              // 涨跌停差贡献
      + (strongRatio - weakRatio) * 0.8          // 强弱股差贡献
      + (amountPercentile - 50) * 0.4            // 量能贡献
      , -100, 100
    );

    return {
      limitUp, limitDown,
      continuousLimitUp: Math.max(0, continuousLimitUp),
      maxContinuousBoard,
      upDownRatio,
      totalAmount: totalAmountYi,
      amountMA5: totalAmountYi, // 单日无法计算MA，后续通过历史补充
      amountPercentile,
      strongStockRatio: strongRatio,
      weakStockRatio: weakRatio,
      sentimentScore: round(sentimentScore),
    };
  } catch {
    return defaults;
  }
}

// ==================== 增强数据：估值 + 换手率 + 筹码 ====================

export interface ValuationData {
  code: string;
  name: string;
  pe: number;              // 市盈率TTM
  pb: number;              // 市净率
  pePercentile: number;    // PE历史分位 0-100
  pbPercentile: number;    // PB历史分位 0-100
  dividendYield: number;   // 股息率%
  totalMarketCap: number;  // 总市值（亿）
}

// 获取ETF/指数估值数据
export async function fetchETFValuations(etfCodes: string[]): Promise<Map<string, ValuationData>> {
  const result = new Map<string, ValuationData>();
  try {
    // 使用东方财富指数估值接口
    for (const code of etfCodes.slice(0, 30)) { // 限制30只
      try {
        const secid = code.startsWith("1") || code.startsWith("5") ? `1.${code}` : `0.${code}`;
        const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f2,f3,f9,f23,f57,f58,f116,f117,f162,f167`;
        const resp = await fetch(url, {
          headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
          next: { revalidate: 300 },
        });
        const json = await resp.json();
        const d = json.data;
        if (!d) continue;

        const pe = Number(d.f9) || Number(d.f162) || 0;
        const pb = Number(d.f23) || Number(d.f167) || 0;

        // 估值分位：基于经验区间估算
        const pePercentile = estimatePercentile(pe, 10, 30, 60);
        const pbPercentile = estimatePercentile(pb, 1, 2.5, 6);

        result.set(code, {
          code,
          name: String(d.f58 || d.f57 || ""),
          pe: round(pe),
          pb: round(pb),
          pePercentile: round(pePercentile),
          pbPercentile: round(pbPercentile),
          dividendYield: Number(d.f117) || 0,
          totalMarketCap: round((Number(d.f116) || 0) / 1e8),
        });
      } catch { /* skip individual failures */ }
    }
  } catch { /* return partial */ }
  return result;
}

export interface TurnoverTrend {
  code: string;
  turnover5d: number;     // 5日平均换手率
  turnover20d: number;    // 20日平均换手率
  turnoverRatio: number;  // 换手率比（5日/20日，>1.5=放量，<0.7=缩量）
  chipConcentration: number; // 筹码集中度估算 0-100（100=高度集中）
}

// 通过K线数据计算换手率趋势 + 筹码集中度
export function calcTurnoverTrend(klines: KLineData[], code: string): TurnoverTrend {
  if (klines.length < 20) return { code, turnover5d: 0, turnover20d: 0, turnoverRatio: 1, chipConcentration: 50 };

  const last20 = klines.slice(-20);
  const last5 = klines.slice(-5);

  // 用成交量作为换手率代理（ETF无直接换手率数据）
  const vol20 = last20.reduce((s, k) => s + k.volume, 0) / 20;
  const vol5 = last5.reduce((s, k) => s + k.volume, 0) / 5;
  const turnoverRatio = vol20 > 0 ? round(vol5 / vol20) : 1;

  // 筹码集中度估算：价格波动范围 / 均价 → 范围小=集中
  const prices = last20.map(k => k.close);
  const maxP = Math.max(...prices);
  const minP = Math.min(...prices);
  const avgP = prices.reduce((s, p) => s + p, 0) / prices.length;
  const priceRange = avgP > 0 ? (maxP - minP) / avgP * 100 : 10;
  // 范围小→集中度高；范围>20%→分散
  const chipConcentration = clampValue(round(100 - priceRange * 5), 0, 100);

  return {
    code,
    turnover5d: round(vol5),
    turnover20d: round(vol20),
    turnoverRatio,
    chipConcentration,
  };
}

// ==================== 聚合数据接口 ====================

export interface EnhancedMarketData {
  sentiment: MarketSentimentData;
  breadth: MarketBreadthData;
  margin: MarginData[];
  northbound: NorthboundFlow[];
}

export async function fetchEnhancedMarketData(): Promise<EnhancedMarketData> {
  const [sentiment, breadth, margin, northbound] = await Promise.all([
    fetchMarketSentimentData(),
    fetchMarketBreadth(),
    fetchMarginData(10),
    fetchNorthboundFlow(20),
  ]);
  return { sentiment, breadth, margin, northbound };
}

// ==================== 个股所属板块 + 概念 ====================

export interface StockSectorInfo {
  code: string;
  sectors: string[];    // 所属行业板块
  concepts: string[];   // 所属概念板块
}

/**
 * 批量获取个股所属板块/概念
 * 利用东方财富个股详情接口获取板块标签
 * @param stockCodes 股票代码列表
 * @returns Map<code, StockSectorInfo>
 */
export async function fetchStockSectors(stockCodes: string[]): Promise<Map<string, StockSectorInfo>> {
  const result = new Map<string, StockSectorInfo>();
  // 限制并发，最多30只
  const codes = stockCodes.slice(0, 30);

  await Promise.all(codes.map(async (code) => {
    try {
      const secid = code.startsWith("6") ? `1.${code}` : `0.${code}`;
      // 东方财富 F10 板块接口：返回个股所属行业和概念
      const url = `https://push2.eastmoney.com/api/qt/slist/get?secid=${secid}&pn=1&pz=50&po=1&np=1&invt=2&fid=f3&fields=f12,f14&spt=3`;
      const resp = await fetch(url, {
        headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 3600 },
      });
      const json = await resp.json();
      const items = json.data?.diff || [];
      const sectors: string[] = [];
      for (const item of items) {
        if (item.f14) sectors.push(String(item.f14));
      }
      if (sectors.length > 0) {
        result.set(code, { code, sectors, concepts: [] });
      }
    } catch { /* skip individual failures */ }
  }));

  // 补充概念板块（通过概念接口）
  await Promise.all(codes.map(async (code) => {
    try {
      const secid = code.startsWith("6") ? `1.${code}` : `0.${code}`;
      const url = `https://push2.eastmoney.com/api/qt/slist/get?secid=${secid}&pn=1&pz=50&po=1&np=1&invt=2&fid=f3&fields=f12,f14&spt=4`;
      const resp = await fetch(url, {
        headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 3600 },
      });
      const json = await resp.json();
      const items = json.data?.diff || [];
      const concepts: string[] = [];
      for (const item of items) {
        if (item.f14) concepts.push(String(item.f14));
      }
      const existing = result.get(code);
      if (existing) {
        existing.concepts = concepts;
      } else if (concepts.length > 0) {
        result.set(code, { code, sectors: [], concepts });
      }
    } catch { /* skip individual failures */ }
  }));

  return result;
}

// ==================== 涨停池详情（封板时间/封单/炸板等） ====================

export interface LimitUpPoolItem {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  amount: number;           // 成交额（元）
  volume: number;           // 成交量（手）
  turnoverRate: number;
  // 涨停特有字段
  firstSealTime: string;    // 首次封板时间 "HH:MM:SS"
  lastSealTime: string;     // 最后封板时间
  sealOrderAmount: number;  // 封单金额（元）
  openCount: number;        // 炸板次数
  consecutiveLimitUp: number; // 连板天数
  limitPrice: number;       // 涨停价
}

/**
 * 获取今日涨停池详情
 * 东方财富涨停板池接口，包含封板时间、封单额、炸板次数等核心数据
 */
export async function fetchLimitUpPool(): Promise<LimitUpPoolItem[]> {
  // 东方财富涨停池接口
  // f2=价格 f3=涨跌幅 f6=成交额 f8=换手率 f12=代码 f14=名称
  // f15=最高 f5=成交量(手)
  // 涨停板专用字段: f10=量比 f22=封单量(手) f11=首次封板时间
  const url = `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cb&dpt=wz.ztzt&Ession=&fields=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13,f14,f15,f17,f18,f20,f22,f23,f24,f25`;

  try {
    const resp = await fetch(url, {
      headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 30 },
    });
    const json = await resp.json();
    const pool = json.data?.pool || [];

    return pool.map((item: Record<string, any>) => {
      // 封板时间从时间戳转换
      const firstTime = item.fbt ? formatTimestamp(item.fbt) : "";
      const lastTime = item.lbt ? formatTimestamp(item.lbt) : "";

      return {
        code: String(item.c || ""),
        name: String(item.n || ""),
        price: Number(item.p) / 1000 || 0,       // 价格(分→元)
        changePercent: Number(item.zdp) / 100 || 0,
        amount: Number(item.amount) || 0,
        volume: Number(item.vol) || 0,
        turnoverRate: Number(item.hs) / 100 || 0,
        firstSealTime: firstTime,
        lastSealTime: lastTime,
        sealOrderAmount: Number(item.fund) || 0,   // 封单金额
        openCount: Number(item.zbc) || 0,           // 炸板次数
        consecutiveLimitUp: Number(item.lbc) || 1,  // 连板天数
        limitPrice: Number(item.p) / 1000 || 0,
      };
    });
  } catch (e) {
    console.error("fetchLimitUpPool error:", e);
    return [];
  }
}

function formatTimestamp(ts: number): string {
  // 东方财富封板时间格式：93500 = 09:35:00
  const s = String(ts).padStart(6, "0");
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
}

/**
 * 从涨停池数据 + K线数据构建 LimitUpDetail
 * 需要配合 fetchKLine 获取前5日均量
 */
export function buildLimitUpDetails(
  poolItems: LimitUpPoolItem[],
  klineMap: Record<string, { volume: number }[]>,
): import("@/lib/limitup-quality").LimitUpDetail[] {
  return poolItems
    .filter(item => item.code.startsWith("60") || item.code.startsWith("00"))
    .map(item => {
      // 计算前5日均量
      const klines = klineMap[item.code] || [];
      const recentVols = klines.slice(-6, -1).map(k => k.volume); // 不含今日
      const avgVolume5d = recentVols.length > 0
        ? recentVols.reduce((a, b) => a + b, 0) / recentVols.length
        : item.volume; // 无历史数据则用今日量作兜底

      return {
        code: item.code,
        name: item.name,
        firstSealTime: item.firstSealTime,
        sealOrderAmount: item.sealOrderAmount,
        totalAmount: item.amount,
        volume: item.volume,
        avgVolume5d,
        consecutiveLimitUp: item.consecutiveLimitUp,
        sealedAtClose: true, // 涨停池里的默认是封死的
        limitPrice: item.limitPrice,
        closePrice: item.price,
        turnoverRate: item.turnoverRate,
        openCount: item.openCount,
      };
    });
}

// ==================== 工具函数 ====================

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function clampValue(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function estimatePercentile(value: number, low: number, mid: number, high: number): number {
  if (value <= 0) return 50;
  if (value <= low) return 10;
  if (value <= mid) return 40;
  if (value <= high) return 70;
  return 90;
}
