# telegram-send-queue

Redis 队列发送 Telegram 消息。任务入队 → Worker 逐个发送 → 限流防 429。

## 安装

```bash
# 从 GitHub 安装（发布前先用这个）
npm install github:AungPhyoOo1931/utils

# 或本地路径开发
npm install ../utils

# 发布后
npm install telegram-send-queue
```

## 快速开始

### 1. 项目入口 — 初始化一次

```js
import { init } from 'telegram-send-queue';

init({ redis: process.env.REDIS_URL });
```

### 2. 任何地方 — 发消息

```js
import { send } from 'telegram-send-queue';

// 文本
await send.push(chatId, 'sendMessage', { text: '你好' });

// 图片
await send.push(chatId, 'sendPhoto', { photo: fileId, caption: '说明' });

// 错误处理
try {
  const msg = await send.push(chatId, 'sendMessage', { text: 'hi' });
  console.log(msg.message_id);
} catch (err) {
  console.error(err.message);
}
```

### 3. Worker

**推荐：项目里 new Bot，传 `bot.api`（共用一份 grammY）**

```js
import { Bot } from 'grammy';
import { init, send, startWorker } from 'telegram-send-queue';

const bot1 = new Bot(process.env.BOT_TOKEN_1);
const bot2 = new Bot(process.env.BOT_TOKEN_2);

init({ redis: process.env.REDIS_URL, defaultBot: 'account1' });

// Worker 和 Bot 跑在同一进程时，直接传 api 实例
startWorker({
  redis: process.env.REDIS_URL,
  bots: { account1: bot1.api, account2: bot2.api },
  defaultBot: 'account1',
});

// 指定账户发送
await send.push(chatId, 'sendMessage', { text: 'hi' }, { bot: 'account2' });
```

**Worker 独立进程时（不能传 JS 对象，改传 tokens）**

```js
startWorker({
  redis: process.env.REDIS_URL,
  tokens: {
    account1: process.env.BOT_TOKEN_1,
    account2: process.env.BOT_TOKEN_2,
  },
  defaultBot: 'account1',
});
```

**CLI（单 token）**

```bash
BOT_TOKEN=xxx REDIS_URL=redis://127.0.0.1:6379 npx telegram-send-worker
```

## 依赖说明

| 包 | 谁装 | 原因 |
|----|------|------|
| `telegram-send-queue` | 项目 | 队列本身 |
| `grammy` | 项目 | 你 new Bot、传 bot.api；CLI/tokens 模式也需要 |
| `ioredis` | 不用 | 队列内部已带 |

传 `bot.api` 模式**不会**有两份 grammY 实例问题。

## API

| 导出 | 说明 |
|------|------|
| `init({ redis, wait })` | 初始化，项目入口调一次。重复调用不覆盖 |
| `send.push(chatId, method, params, opts?)` | 投递发送任务 |
| `send.close()` | 关闭 Redis 连接 |
| `startWorker({ botToken, redis, chatIntervalMs })` | 启动消费进程 |

### send.push 参数

- `chatId` — 目标 chat
- `method` — grammY API 方法名：`sendMessage` / `sendPhoto` / `sendDocument` ...
- `params` — 方法参数（`chat_id` 不用写）
- `opts.wait` — 默认 `true`，等待发送完成；`false` 只入队

## 发布到 npm

```bash
npm login
npm publish
```

如果包名 `telegram-send-queue` 已被占用，修改 `package.json` 的 `name` 为你的 scope，例如 `@yourname/telegram-send-queue`。

## License

MIT
