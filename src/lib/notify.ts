/**
 * 通知推送系统
 *
 * 支持渠道：
 *   - 飞书 Webhook（自定义机器人）
 *   - 企业微信 Webhook
 *   - 本地日志（兜底）
 *
 * 配置方式：环境变量
 *   FEISHU_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/xxx
 *   WECOM_WEBHOOK=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
 */

import * as fs from "fs";
import * as path from "path";

// ================================================================
//  类型
// ================================================================

export type NotifyLevel = "紧急" | "警告" | "提示" | "日报";

export interface NotifyMessage {
  level: NotifyLevel;
  title: string;
  content: string;
  timestamp?: string;
}

export interface NotifyResult {
  channel: string;
  success: boolean;
  error?: string;
}

// ================================================================
//  推送入口
// ================================================================

export async function sendNotification(msg: NotifyMessage): Promise<NotifyResult[]> {
  const results: NotifyResult[] = [];
  msg.timestamp = msg.timestamp || new Date().toISOString();

  // 飞书
  const feishuUrl = process.env.FEISHU_WEBHOOK;
  if (feishuUrl) {
    results.push(await sendFeishu(feishuUrl, msg));
  }

  // 企业微信
  const wecomUrl = process.env.WECOM_WEBHOOK;
  if (wecomUrl) {
    results.push(await sendWeCom(wecomUrl, msg));
  }

  // 本地日志（始终记录）
  results.push(logToFile(msg));

  return results;
}

// ================================================================
//  飞书
// ================================================================

async function sendFeishu(url: string, msg: NotifyMessage): Promise<NotifyResult> {
  try {
    const levelEmoji = msg.level === "紧急" ? "🚨" : msg.level === "警告" ? "⚠️" : msg.level === "提示" ? "💡" : "📊";
    const body = {
      msg_type: "interactive",
      card: {
        header: {
          title: { tag: "plain_text", content: `${levelEmoji} ${msg.title}` },
          template: msg.level === "紧急" ? "red" : msg.level === "警告" ? "orange" : "blue",
        },
        elements: [
          { tag: "markdown", content: msg.content },
          { tag: "note", elements: [{ tag: "plain_text", content: msg.timestamp || "" }] },
        ],
      },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    return { channel: "飞书", success: data.code === 0 || data.StatusCode === 0, error: data.msg };
  } catch (e: any) {
    return { channel: "飞书", success: false, error: e.message };
  }
}

// ================================================================
//  企业微信
// ================================================================

async function sendWeCom(url: string, msg: NotifyMessage): Promise<NotifyResult> {
  try {
    const body = {
      msgtype: "markdown",
      markdown: {
        content: `## ${msg.title}\n\n${msg.content}\n\n> ${msg.timestamp}`,
      },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    return { channel: "企业微信", success: data.errcode === 0, error: data.errmsg };
  } catch (e: any) {
    return { channel: "企业微信", success: false, error: e.message };
  }
}

// ================================================================
//  本地日志
// ================================================================

function logToFile(msg: NotifyMessage): NotifyResult {
  try {
    const logDir = path.join(process.cwd(), ".data", "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(logDir, `notify-${today}.log`);
    const line = `[${msg.timestamp}] [${msg.level}] ${msg.title}\n${msg.content}\n${"=".repeat(60)}\n`;
    fs.appendFileSync(logFile, line, "utf-8");
    return { channel: "本地日志", success: true };
  } catch (e: any) {
    return { channel: "本地日志", success: false, error: e.message };
  }
}

// ================================================================
//  便捷方法
// ================================================================

export async function notifyAlert(level: NotifyLevel, title: string, content: string) {
  return sendNotification({ level, title, content });
}

export async function notifyDailyReport(summary: string) {
  return sendNotification({ level: "日报", title: "量化策略日报", content: summary });
}
