/**
 * Telegram 发送队列
 *
 * 复制整个 utils 到项目，主项目安装：npm install ioredis grammy
 *
 * ── 1. 项目入口初始化一次 ──
 *   import { init } from './utils/index.js';
 *   init({ redis: process.env.REDIS_URL });
 *
 * ── 2. 任何地方发消息（import send 直接用）──
 *   import { send } from './utils/index.js';
 *   await send.push(chatId, 'sendMessage', { text: '你好' });
 *
 * ── 3. Worker 单独进程 ──
 *   import { startWorker } from './utils/index.js';
 *   startWorker({ botToken: process.env.BOT_TOKEN, redis: process.env.REDIS_URL });
 */

export { init, send } from './queue.js';
export { startWorker } from './worker.js';
