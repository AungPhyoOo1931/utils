/**
 * Telegram 发送队列 — 消费者
 *
 * 推荐：在项目里 new Bot()，把 bot.api 传进来（共用同一份 grammY，无重复实例问题）
 *
 * ── 单账户 ──
 *   const bot = new Bot(process.env.BOT_TOKEN);
 *   startWorker({ redis: process.env.REDIS_URL, api: bot.api });
 *
 * ── 多账户轮询 ──
 *   const bot1 = new Bot(process.env.BOT_TOKEN_1);
 *   const bot2 = new Bot(process.env.BOT_TOKEN_2);
 *   startWorker({
 *     redis: process.env.REDIS_URL,
 *     bots: { account1: bot1.api, account2: bot2.api },
 *     defaultBot: 'account1',
 *   });
 *   await send.push(chatId, 'sendMessage', { text: 'hi' }, { bot: 'account2' });
 *
 * ── Worker 独立进程（无法传 JS 对象，改传 tokens）──
 *   startWorker({
 *     redis: process.env.REDIS_URL,
 *     tokens: { account1: process.env.BOT_TOKEN_1, account2: process.env.BOT_TOKEN_2 },
 *     defaultBot: 'account1',
 *   });
 */

import { createRequire } from 'node:module';
import Redis from 'ioredis';

const require = createRequire(import.meta.url);

const QUEUE_KEY = 'tg:send:queue';
const DONE_PREFIX = 'tg:send:done:';
const DONE_TTL_SEC = 60;
const CHAT_INTERVAL_MS = 1000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 用 tokens 时才加载 grammY，避免模块里多装一份 */
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

/**
 * 组装 bot 实例表
 * @returns {Map<string, object>} botKey → api 实例
 */
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

/**
 * @param {object} opts
 * @param {string|object} opts.redis
 * @param {object}  [opts.api]         - 单个 bot.api（项目里 new Bot 后传入）
 * @param {object}  [opts.bots]        - 多账户：{ account1: bot1.api, account2: bot2.api }
 * @param {object}  [opts.tokens]      - 独立进程用：{ account1: 'token...', account2: 'token...' }
 * @param {string}  [opts.botToken]    - 单 token 简写（CLI 用）
 * @param {string}  [opts.defaultBot]  - 默认账户 key，默认 'default'
 * @param {number}  [opts.chatIntervalMs]
 */
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
  const lastSent = new Map(); // "botKey:chatId" → timestamp

  function getApi(botKey) {
    const key = botKey ?? defaultBot;
    const instance = botMap.get(key);
    if (!instance) {
      throw new Error(`未注册的 bot: ${key}，可用: ${[...botMap.keys()].join(', ')}`);
    }
    return instance;
  }

  console.log(
    `[send-worker] 已启动，账户: ${[...botMap.keys()].join(', ')}，默认: ${defaultBot}`,
  );

  (async () => {
    while (true) {
      const item = await client.brpop(QUEUE_KEY, 0);
      if (!item) continue;

      const task = JSON.parse(item[1]);
      const { id, chatId, method, params, bot: taskBot } = task;
      const botKey = taskBot ?? defaultBot;
      const rateKey = `${botKey}:${chatId}`;

      const last = lastSent.get(rateKey) ?? 0;
      const gap = chatIntervalMs - (Date.now() - last);
      if (gap > 0) await sleep(gap);

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
