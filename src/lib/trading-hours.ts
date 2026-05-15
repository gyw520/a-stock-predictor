/**
 * A股交易时段判断工具
 * 交易时间：周一至周五 9:30-11:30, 13:00-15:00
 */

export function isTradingTime(): boolean {
  const now = new Date();
  // 转换为北京时间 (UTC+8)
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const beijing = new Date(utc + 8 * 3600000);

  const day = beijing.getDay();
  if (day === 0 || day === 6) return false; // 周末

  const h = beijing.getHours();
  const m = beijing.getMinutes();
  const t = h * 60 + m;

  // 9:15-11:30 (含集合竞价) 或 13:00-15:00
  return (t >= 555 && t <= 690) || (t >= 780 && t <= 900);
}

// 是否接近收盘（14:30-15:00）
export function isNearClose(): boolean {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const beijing = new Date(utc + 8 * 3600000);

  const day = beijing.getDay();
  if (day === 0 || day === 6) return false;

  const t = beijing.getHours() * 60 + beijing.getMinutes();
  return t >= 870 && t <= 900;
}

// 获取合适的轮询间隔（毫秒）
export function getPollingInterval(): number {
  if (!isTradingTime()) return 0; // 非交易时段不轮询
  if (isNearClose()) return 10000; // 收盘前10秒一次
  return 15000; // 盘中15秒一次
}
