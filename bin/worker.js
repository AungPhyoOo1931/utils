#!/usr/bin/env node
/**
 * CLI：启动发送 Worker
 *
 * 环境变量：
 *   BOT_TOKEN   - Telegram Bot Token
 *   REDIS_URL   - Redis 连接地址
 *
 * 用法：
 *   npx telegram-send-worker
 *   npm run worker
 */

import { startWorker } from '../worker.js';

startWorker({
  botToken: process.env.BOT_TOKEN,
  redis: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
});
