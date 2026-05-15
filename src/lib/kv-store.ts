// 统一 KV 存储抽象层
// 本地环境：fs 写入 .data/ 目录（保持现有行为）
// Netlify 环境：@netlify/blobs KV 存储（数据持久化）

import fs from "fs";
import path from "path";

const isNetlify = !!process.env.NETLIFY;
const DATA_DIR = path.join(process.cwd(), ".data");

let netlifyStore: any = null;
async function getStore() {
  if (!netlifyStore) {
    const { getStore } = await import("@netlify/blobs");
    netlifyStore = getStore("a-stock-predictor");
  }
  return netlifyStore;
}

export async function kvLoad<T>(key: string, defaultValue: T): Promise<T> {
  if (isNetlify) {
    const store = await getStore();
    const data = await store.get(key);
    if (data) {
      try { return JSON.parse(data) as T; } catch { return defaultValue; }
    }
    return defaultValue;
  }
  // 本地环境：fs
  const filePath = path.join(DATA_DIR, `${key}.json`);
  if (fs.existsSync(filePath)) {
    try { return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T; } catch {}
  }
  return defaultValue;
}

export async function kvSave<T>(key: string, data: T): Promise<void> {
  if (isNetlify) {
    const store = await getStore();
    await store.set(key, JSON.stringify(data));
    return;
  }
  // 本地环境：fs
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const filePath = path.join(DATA_DIR, `${key}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}