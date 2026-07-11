# telegram-send-queue

Telegram 消息发送队列。任务写入 Redis，Worker 按序发送，内置限流。

## 安装

```bash
npm install telegram-send-queue grammy
```

需要 Redis。`grammy` 由你的项目安装（用于 `new Bot` 和传 `bot.api`）。

## 快速开始

**入口 — 初始化**

```js
import { init } from 'telegram-send-queue';

init({ redis: process.env.REDIS_URL });
```

**Worker — 单独进程**

```js
import { Bot } from 'grammy';
import { startWorker } from 'telegram-send-queue';

const bot = new Bot(process.env.BOT_TOKEN);

startWorker({
  redis: process.env.REDIS_URL,
  api: bot.api,
});
```

**发消息**

```js
import { send } from 'telegram-send-queue';

await send.push(chatId, 'sendMessage', { text: '你好' });
await send.push(chatId, 'sendPhoto', { photo: fileId, caption: '说明' });
```

默认会等待 Worker 发送完成，失败时 `throw`。只入队不等结果：

```js
await send.push(chatId, 'sendMessage', { text: 'hi' }, { wait: false });
```

## 多账户

```js
const bot1 = new Bot(process.env.BOT_TOKEN_1);
const bot2 = new Bot(process.env.BOT_TOKEN_2);

init({ redis: process.env.REDIS_URL, defaultBot: 'main' });

startWorker({
  redis: process.env.REDIS_URL,
  bots: { main: bot1.api, backup: bot2.api },
  defaultBot: 'main',
});

await send.push(chatId, 'sendMessage', { text: '主号发' });
await send.push(chatId, 'sendMessage', { text: '备用号发' }, { bot: 'backup' });
```

Worker 跑在独立进程、无法传 JS 对象时，改用 `tokens`：

```js
startWorker({
  redis: process.env.REDIS_URL,
  tokens: { main: process.env.BOT_TOKEN_1, backup: process.env.BOT_TOKEN_2 },
  defaultBot: 'main',
});
```

## CLI

单 token、独立进程：

```bash
BOT_TOKEN=xxx REDIS_URL=redis://127.0.0.1:6379 npx telegram-send-worker
```

## API

| 方法 | 说明 |
|------|------|
| `init({ redis, wait?, defaultBot? })` | 初始化，入口调一次。重复调用不覆盖 |
| `send.push(chatId, method, params, opts?)` | 投递发送任务 |
| `send.close()` | 关闭 Redis 连接 |
| `startWorker({ redis, api?, bots?, tokens?, botToken?, defaultBot?, chatIntervalMs? })` | 启动 Worker |

**`send.push` 常用 method：** `sendMessage` `sendPhoto` `sendDocument` `sendVideo` `sendMediaGroup` `editMessageText` `deleteMessage`

**`opts`：** `wait`（默认 `true`） · `bot`（多账户 key）

## License

MIT
