/**
 * Telegram 发送队列 — 消费者（单独一个进程跑）
 *
 * 原理：循环从 Redis 列表 RPOP 取任务 → 调 Telegram API 发送 → 回写结果。
 *
 * 主项目依赖（在主项目里 npm install，这里不装）：
 *   npm install ioredis grammy
 *
 * 用法：
 *   import { startWorker } from './utils/worker.js';
 *
 *   startWorker({
 *     botToken: process.env.BOT_TOKEN,
 *     redis: 'redis://127.0.0.1:6379',
 *   });
 *
 *   // 然后另开终端跑你的 Bot 就行
 */

import Redis from 'ioredis';
import { Api } from 'grammy';

const QUEUE_KEY = 'tg:send:queue';
const DONE_PREFIX = 'tg:send:done:';
const DONE_TTL_SEC = 60;
const CHAT_INTERVAL_MS = 1000; // 同一 chat 最少间隔 1 秒，防 Telegram 限流

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 启动发送 Worker（阻塞式，一般作为独立进程入口）
 */
export function startWorker({ botToken, redis, chatIntervalMs = CHAT_INTERVAL_MS }) {
  if (!botToken) throw new Error('botToken 必填');
  if (!redis) throw new Error('redis 必填');

  const client = new Redis(redis);
  const api = new Api(botToken);
  const lastSent = new Map(); // chatId → 上次发送时间戳

  console.log('[send-worker] 已启动，等待任务...');

  // 主循环
  (async () => {
    while (true) {
      // 阻塞等待任务（BRPOP：列表为空时挂起，有任务立刻返回）
      const item = await client.brpop(QUEUE_KEY, 0);
      if (!item) continue;

      const task = JSON.parse(item[1]);
      const { id, chatId, method, params } = task;

      // 单 chat 限流：距上次发送不足 interval 就等一等
      const last = lastSent.get(chatId) ?? 0;
      const gap = chatIntervalMs - (Date.now() - last);
      if (gap > 0) await sleep(gap);

      let result = null;
      let error = null;
      let detail = null;

      // 发送，429 限流时原地重试
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          result = await callApi(api, method, chatId, params);
          lastSent.set(chatId, Date.now());
          error = null;
          break;
        } catch (err) {
          if (err.error_code === 429 && attempt < 4) {
            const sec = err.parameters?.retry_after ?? 3;
            console.log(`[send-worker] 被限流，${sec}s 后重试 (${attempt + 1}/5)`);
            await sleep(sec * 1000);
            continue;
          }
          error = err.message ?? String(err);
          detail = err;
          console.error(`[send-worker] 发送失败 [${method}] chat=${chatId}:`, error);
          break;
        }
      }

      // 回写结果，让 push() 端的 BRPOP 收到
      const doneKey = `${DONE_PREFIX}${id}`;
      await client.lpush(
        doneKey,
        JSON.stringify({ result, error, detail: error ? String(detail) : null }),
      );
      await client.expire(doneKey, DONE_TTL_SEC);
    }
  })().catch((err) => {
    console.error('[send-worker] 循环异常退出:', err);
    process.exit(1);
  });

  // 优雅退出
  const shutdown = async () => {
    console.log('[send-worker] 正在关闭...');
    await client.quit();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

/**
 * 根据 method 名自动拼参数调用 Api
 * grammY 的方法签名大多是 (chatId, ...args, options?)
 */
async function callApi(api, method, chatId, params) {
  const fn = api[method];

  switch (method) {
    case 'sendMessage':
      return fn.call(api, chatId, params.text, rest(params, 'text'));

    case 'sendPhoto':
      return fn.call(api, chatId, params.photo, rest(params, 'photo'));

    case 'sendDocument':
      return fn.call(api, chatId, params.document, rest(params, 'document'));

    case 'sendVideo':
      return fn.call(api, chatId, params.video, rest(params, 'video'));

    case 'sendAudio':
      return fn.call(api, chatId, params.audio, rest(params, 'audio'));

    case 'sendVoice':
      return fn.call(api, chatId, params.voice, rest(params, 'voice'));

    case 'sendSticker':
      return fn.call(api, chatId, params.sticker, rest(params, 'sticker'));

    case 'sendAnimation':
      return fn.call(api, chatId, params.animation, rest(params, 'animation'));

    case 'sendLocation':
      return fn.call(api, chatId, params.latitude, params.longitude, rest(params, 'latitude', 'longitude'));

    case 'sendPoll':
      return fn.call(api, chatId, params.question, params.options, rest(params, 'question', 'options'));

    case 'sendDice':
      return fn.call(api, chatId, params.emoji ?? '🎲', rest(params, 'emoji'));

    case 'sendMediaGroup':
      return fn.call(api, chatId, params.media, rest(params, 'media'));

    case 'sendChatAction':
      return fn.call(api, chatId, params.action, rest(params, 'action'));

    case 'editMessageText':
      return fn.call(api, chatId, params.message_id, params.text, rest(params, 'message_id', 'text'));

    case 'editMessageCaption':
      return fn.call(api, chatId, params.message_id, rest(params, 'message_id'));

    case 'deleteMessage':
      return fn.call(api, chatId, params.message_id);

    case 'copyMessage':
      return fn.call(api, chatId, params.from_chat_id, params.message_id, rest(params, 'from_chat_id', 'message_id'));

    case 'forwardMessage':
      return fn.call(api, chatId, params.from_chat_id, params.message_id, rest(params, 'from_chat_id', 'message_id'));

    default:
      // 兜底：把 params 原样展开，加上 chat_id
      return api.raw[method].call(api.raw, { chat_id: chatId, ...params });
  }
}

/** 去掉已单独传的主参数，剩下当 options */
function rest(obj, ...keys) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return Object.keys(out).length ? out : undefined;
}
