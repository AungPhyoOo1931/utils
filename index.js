/**
 * telegram-send-queue
 *
 * 安装：npm install telegram-send-queue
 *       或 npm install github:AungPhyoOo1931/utils
 *
 * ── 1. 项目入口初始化一次 ──
 *   import { init } from 'telegram-send-queue';
 *   init({ redis: process.env.REDIS_URL });
 *
 * ── 2. 任何地方发消息 ──
 *   import { send } from 'telegram-send-queue';
 *   await send.push(chatId, 'sendMessage', { text: '你好' });
 *
 * ── 3. Worker — 传入项目里 new 好的 bot.api（推荐，避免两份 grammY）──
 *   import { Bot } from 'grammy';
 *   const bot = new Bot(process.env.BOT_TOKEN);
 *   startWorker({ redis: process.env.REDIS_URL, api: bot.api });
 *
 *   或用 CLI（独立进程，走 token）：BOT_TOKEN=xxx npx telegram-send-worker
 */

export { init, send } from './queue.js';
export { startWorker } from './worker.js';
