/**
 * Telegram 发送队列 — 生产者
 *
 * init 选项：
 *   maxPendingPerChat - 单 chat 最多几条待发，默认 3，0=不限制
 *   dropOld           - 同 chat 新消息覆盖旧的，默认 false
 */

import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import {
  CONFIG_KEY,
  DEFAULT_MAX_PENDING_PER_CHAT,
  DONE_TTL_SEC,
  QUEUE_KEY,
  doneKey,
  latestKey,
  pendingKey,
} from './keys.js';

let client = null;
let defaultWait = true;
let defaultBot = 'default';
let initRedis = null;

/**
 * @param {object} opts
 * @param {string|object} opts.redis
 * @param {boolean}     [opts.wait=true]
 * @param {string}      [opts.defaultBot='default']
 * @param {number}      [opts.maxPendingPerChat=3]  单 chat 最大待发数，0=不限制
 * @param {boolean}     [opts.dropOld=false]         同 chat 只发最新一条
 */
export function init({
  redis,
  wait = true,
  defaultBot: bot = 'default',
  maxPendingPerChat = DEFAULT_MAX_PENDING_PER_CHAT,
  dropOld = false,
} = {}) {
  const url = redis ?? process.env.REDIS_URL;

  if (client) {
    const sameRedis =
      url === initRedis ||
      (typeof url === 'string' && url === initRedis);
    if (!sameRedis) {
      console.warn(
        '[send] init() 已执行过，忽略本次调用（不会切换到新的 redis）',
      );
    }
    return;
  }

  if (!url) {
    throw new Error('init({ redis }) 或环境变量 REDIS_URL 必须提供一个');
  }

  client =
    typeof url === 'string' || url?.host || url?.port
      ? new Redis(url)
      : url;

  initRedis = url;
  defaultWait = wait;
  defaultBot = bot;

  client
    .set(
      CONFIG_KEY,
      JSON.stringify({ maxPendingPerChat, dropOld }),
    )
    .catch((err) => {
      console.warn('[send] 写入配置失败:', err.message);
    });
}

function ensureClient() {
  if (!client) init();
  return client;
}

async function readConfig(redis) {
  try {
    const raw = await redis.get(CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {
    maxPendingPerChat: DEFAULT_MAX_PENDING_PER_CHAT,
    dropOld: false,
  };
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.wait]
 * @param {string}  [opts.bot]
 */
async function push(chatId, method, params = {}, opts = {}) {
  const redis = ensureClient();
  const config = await readConfig(redis);
  const taskId = randomUUID();
  const bot = opts.bot ?? defaultBot;
  const shouldWait = opts.wait ?? defaultWait;
  const pKey = pendingKey(bot, chatId);

  // 单 chat 待发上限
  if (config.maxPendingPerChat > 0) {
    const count = await redis.incr(pKey);
    if (count > config.maxPendingPerChat) {
      await redis.decr(pKey);
      const err = new Error(
        `发送队列已满（单 chat 最多 ${config.maxPendingPerChat} 条待发），请稍后再试`,
      );
      err.code = 'QUEUE_FULL';
      throw err;
    }
  }

  // 只保留最新：标记当前 taskId，旧任务由 Worker 跳过
  if (config.dropOld) {
    await redis.set(latestKey(bot, chatId), taskId);
  }

  const task = JSON.stringify({ id: taskId, chatId, method, params, bot });

  try {
    await redis.lpush(QUEUE_KEY, task);
  } catch (err) {
    if (config.maxPendingPerChat > 0) {
      await redis.decr(pKey).catch(() => {});
    }
    throw new Error(`入队失败: ${err.message}`);
  }

  if (!shouldWait) return taskId;

  const reply = await redis.brpop(doneKey(taskId), 30);
  if (!reply) {
    throw new Error('发送超时（30s），请确认 Worker 是否在运行');
  }

  const data = JSON.parse(reply[1]);
  if (data.skipped) {
    return null;
  }
  if (data.error) {
    const err = new Error(data.error);
    err.cause = data.detail;
    throw err;
  }
  return data.result;
}

async function close() {
  if (client) {
    await client.quit();
    client = null;
    initRedis = null;
  }
}

export const send = { push, close };
