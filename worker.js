/**
 * Telegram 发送队列 — 消费者
 *
 * 公平调度：某 chat 在冷却期内不阻塞全局，任务进延迟队列，先处理其他用户。
 */

import { createRequire } from 'node:module';
import Redis from 'ioredis';
import {
  CONFIG_KEY,
  DEFAULT_MAX_PENDING_PER_CHAT,
  DELAY_KEY,
  DONE_TTL_SEC,
  QUEUE_KEY,
  doneKey,
  latestKey,
  pendingKey,
} from './keys.js';

const require = createRequire(import.meta.url);
const CHAT_INTERVAL_MS = 1000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function createApiFromToken(token) {
  let Api;
  try {
    Api = require('grammy').Api;
  } catch {
    throw new Error(
      '使用 tokens/botToken 模式需要安装 grammy：npm install grammy',
    );
  }
  return new Api(token);
}

function buildBotMap({ api, bots, tokens, botToken }) {
  const map = new Map();

  if (api) map.set('default', api);

  if (bots) {
    for (const [key, instance] of Object.entries(bots)) {
      map.set(key, instance);
    }
  }

  if (tokens) {
    for (const [key, token] of Object.entries(tokens)) {
      map.set(key, createApiFromToken(token));
    }
  }

  if (botToken && map.size === 0) {
    map.set('default', createApiFromToken(botToken));
  }

  if (map.size === 0) {
    throw new Error(
      'startWorker 需要 api / bots / tokens / botToken 至少提供一个',
    );
  }

  return map;
}

async function readConfig(client) {
  try {
    const raw = await client.get(CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {
    maxPendingPerChat: DEFAULT_MAX_PENDING_PER_CHAT,
    dropOld: false,
  };
}

/** 从主队列或延迟队列取一条任务 */
async function takeNextTask(client) {
  const now = Date.now();
  const delayed = await client.zrangebyscore(DELAY_KEY, 0, now, 'LIMIT', 0, 1);
  if (delayed.length > 0) {
    const removed = await client.zrem(DELAY_KEY, delayed[0]);
    if (removed) return delayed[0];
  }

  const item = await client.brpop(QUEUE_KEY, 1);
  return item ? item[1] : null;
}

async function finishTask(client, config, { id, botKey, chatId, result, error, detail, skipped }) {
  if (config.maxPendingPerChat > 0) {
    const pKey = pendingKey(botKey, chatId);
    const n = await client.decr(pKey);
    if (n < 0) await client.set(pKey, '0');
  }

  const key = doneKey(id);
  await client.lpush(
    key,
    JSON.stringify({
      result: skipped ? null : result,
      error: skipped ? null : error,
      detail: error ? String(detail) : null,
      skipped: !!skipped,
    }),
  );
  await client.expire(key, DONE_TTL_SEC);
}

export function startWorker({
  redis,
  api,
  bots,
  tokens,
  botToken,
  defaultBot = 'default',
  chatIntervalMs = CHAT_INTERVAL_MS,
}) {
  if (!redis) throw new Error('redis 必填');

  const botMap = buildBotMap({ api, bots, tokens, botToken });
  const client = new Redis(redis);
  const lastSent = new Map();

  function getApi(botKey) {
    const key = botKey ?? defaultBot;
    const instance = botMap.get(key);
    if (!instance) {
      throw new Error(
        `未注册的 bot: ${key}，可用: ${[...botMap.keys()].join(', ')}`,
      );
    }
    return instance;
  }

  console.log(
    `[send-worker] 已启动，账户: ${[...botMap.keys()].join(', ')}，默认: ${defaultBot}`,
  );

  (async () => {
    while (true) {
      const config = await readConfig(client);
      const raw = await takeNextTask(client);
      if (!raw) continue;

      const task = JSON.parse(raw);
      const { id, chatId, method, params, bot: taskBot } = task;
      const botKey = taskBot ?? defaultBot;
      const rateKey = `${botKey}:${chatId}`;

      // dropOld：已被更新的任务直接跳过
      if (config.dropOld) {
        const latest = await client.get(latestKey(botKey, chatId));
        if (latest && latest !== id) {
          await finishTask(client, config, {
            id,
            botKey,
            chatId,
            skipped: true,
          });
          continue;
        }
      }

      // 公平调度：冷却中 → 进延迟队列，不阻塞其他 chat
      const last = lastSent.get(rateKey) ?? 0;
      const gap = chatIntervalMs - (Date.now() - last);
      if (gap > 0) {
        await client.zadd(DELAY_KEY, Date.now() + gap, raw);
        continue;
      }

      let result = null;
      let error = null;
      let detail = null;

      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const apiInstance = getApi(botKey);
          result = await callApi(apiInstance, method, chatId, params);
          lastSent.set(rateKey, Date.now());
          error = null;
          break;
        } catch (err) {
          if (err.error_code === 429 && attempt < 4) {
            const sec = err.parameters?.retry_after ?? 3;
            console.log(
              `[send-worker] [${botKey}] 被限流，${sec}s 后重试 (${attempt + 1}/5)`,
            );
            await sleep(sec * 1000);
            continue;
          }
          error = err.message ?? String(err);
          detail = err;
          console.error(
            `[send-worker] [${botKey}] 发送失败 [${method}] chat=${chatId}:`,
            error,
          );
          break;
        }
      }

      await finishTask(client, config, {
        id,
        botKey,
        chatId,
        result,
        error,
        detail,
      });
    }
  })().catch((err) => {
    console.error('[send-worker] 循环异常退出:', err);
    process.exit(1);
  });

  const shutdown = async () => {
    console.log('[send-worker] 正在关闭...');
    await client.quit();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

async function callApi(api, method, chatId, params) {
  const fn = api[method];
  if (typeof fn !== 'function' && !api.raw?.[method]) {
    throw new Error(`未知的 API 方法: ${method}`);
  }

  switch (method) {
    case 'sendMessage':
      return api.sendMessage(chatId, params.text, rest(params, 'text'));
    case 'sendPhoto':
      return api.sendPhoto(chatId, params.photo, rest(params, 'photo'));
    case 'sendDocument':
      return api.sendDocument(chatId, params.document, rest(params, 'document'));
    case 'sendVideo':
      return api.sendVideo(chatId, params.video, rest(params, 'video'));
    case 'sendAudio':
      return api.sendAudio(chatId, params.audio, rest(params, 'audio'));
    case 'sendVoice':
      return api.sendVoice(chatId, params.voice, rest(params, 'voice'));
    case 'sendSticker':
      return api.sendSticker(chatId, params.sticker, rest(params, 'sticker'));
    case 'sendAnimation':
      return api.sendAnimation(chatId, params.animation, rest(params, 'animation'));
    case 'sendLocation':
      return api.sendLocation(
        chatId,
        params.latitude,
        params.longitude,
        rest(params, 'latitude', 'longitude'),
      );
    case 'sendPoll':
      return api.sendPoll(
        chatId,
        params.question,
        params.options,
        rest(params, 'question', 'options'),
      );
    case 'sendDice':
      return api.sendDice(chatId, params.emoji ?? '🎲', rest(params, 'emoji'));
    case 'sendMediaGroup':
      return api.sendMediaGroup(chatId, params.media, rest(params, 'media'));
    case 'sendChatAction':
      return api.sendChatAction(chatId, params.action, rest(params, 'action'));
    case 'editMessageText':
      return api.editMessageText(
        chatId,
        params.message_id,
        params.text,
        rest(params, 'message_id', 'text'),
      );
    case 'editMessageCaption':
      return api.editMessageCaption(
        chatId,
        params.message_id,
        rest(params, 'message_id'),
      );
    case 'deleteMessage':
      return api.deleteMessage(chatId, params.message_id);
    case 'copyMessage':
      return api.copyMessage(
        chatId,
        params.from_chat_id,
        params.message_id,
        rest(params, 'from_chat_id', 'message_id'),
      );
    case 'forwardMessage':
      return api.forwardMessage(
        chatId,
        params.from_chat_id,
        params.message_id,
        rest(params, 'from_chat_id', 'message_id'),
      );
    default:
      return api.raw[method].call(api.raw, { chat_id: chatId, ...params });
  }
}

function rest(obj, ...keys) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return Object.keys(out).length ? out : undefined;
}
