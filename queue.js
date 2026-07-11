/**
 * Telegram 发送队列 — 生产者
 *
 * 全局单例，整个项目只初始化一次，到处 import send 直接用。
 *
 * 主项目依赖：npm install ioredis
 *
 * ── 项目入口初始化一次（推荐）──
 *   import { init, send } from './utils/index.js';
 *   init({ redis: process.env.REDIS_URL });
 *
 * ── 任何地方发消息 ──
 *   import { send } from './utils/index.js';
 *   await send.push(chatId, 'sendMessage', { text: '你好' });
 *   await send.push(chatId, 'sendPhoto', { photo: fileId, caption: '说明' });
 *
 * ── 错误处理 ──
 *   try {
 *     const msg = await send.push(chatId, 'sendMessage', { text: 'hi' });
 *   } catch (err) {
 *     console.error(err.message); // 入队失败 / 发送失败 / 超时
 *   }
 *
 * ── 只入队不等结果 ──
 *   await send.push(chatId, 'sendMessage', { text: 'hi' }, { wait: false });
 */

import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

const QUEUE_KEY = 'tg:send:queue';
const DONE_PREFIX = 'tg:send:done:';
const DONE_TTL_SEC = 60;

let client = null;
let defaultWait = true;
let initRedis = null; // 记录首次配置，用于检测重复 init

/**
 * 项目入口调用一次。
 * 重复调用不会覆盖已有连接，第二次及以后会 warn 并直接 return。
 * @param {object} opts
 * @param {string|object} opts.redis  - Redis 连接，如 process.env.REDIS_URL
 * @param {boolean}     opts.wait     - 默认是否等待发送完成，默认 true
 */
export function init({ redis, wait = true } = {}) {
  const url = redis ?? process.env.REDIS_URL;

  // 已初始化：不覆盖，不新建连接，之前 push 过的任务不受影响
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
}

function ensureClient() {
  if (!client) init();
  return client;
}

/**
 * 投递一条发送任务
 * @param {number|string} chatId
 * @param {string}        method   - sendMessage / sendPhoto / sendDocument ...
 * @param {object}        params   - 方法参数（chat_id 不用写）
 * @param {object}        opts
 * @param {boolean}       opts.wait
 */
async function push(chatId, method, params = {}, opts = {}) {
  const redis = ensureClient();
  const taskId = randomUUID();
  const task = JSON.stringify({ id: taskId, chatId, method, params });
  const shouldWait = opts.wait ?? defaultWait;

  try {
    await redis.lpush(QUEUE_KEY, task);
  } catch (err) {
    throw new Error(`入队失败: ${err.message}`);
  }

  if (!shouldWait) return taskId;

  const reply = await redis.brpop(`${DONE_PREFIX}${taskId}`, 30);
  if (!reply) {
    throw new Error('发送超时（30s），请确认 Worker 是否在运行');
  }

  const data = JSON.parse(reply[1]);
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

/** 全局发送实例，直接 send.push() 即可 */
export const send = { push, close };
