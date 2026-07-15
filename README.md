# telegram-send-queue

Telegram 消息发送队列。任务写入 Redis，Worker 按序发送，内置限流。

## 安装

```bash
npm install telegram-send-queue grammy
```

需要 Redis。`grammy` 由你的项目安装（用于 `new Bot` 和传 `bot.api`）。

## 快速开始

```js
import { Bot } from 'grammy';
import { config } from 'dotenv';
import { init, send, startWorker } from 'telegram-send-queue';

config();

const bot = new Bot(process.env.BOT_TOKEN);

init({ redis: process.env.REDIS_URL || 'redis://localhost:6379' });

startWorker({
  redis: process.env.REDIS_URL || 'redis://localhost:6379',
  api: bot.api,
});

bot.command('start', async (ctx) => {
  await send.push(ctx.chat.id, 'sendMessage', { text: 'Hello!' });
});

bot.start();
```

其他文件只需引入 `send`：

```js
import { send } from 'telegram-send-queue';

await send.push(chatId, 'sendMessage', { text: '你好' });
```

## send.push 用法

统一格式：

```js
await send.push(chatId, '方法名', { 参数 }, { wait?, bot? });
```

- `chatId` — 目标 chat
- 方法名 — grammY API 方法名（见下方列表）
- 参数 — 该方法需要的字段（`chat_id` 不用写）
- 第四个参数可选：`wait`（默认 `true`，等发送完成）· `bot`（多账户 key）

错误会 `throw`，用 `try/catch` 接住：

```js
try {
  const msg = await send.push(chatId, 'sendMessage', { text: 'hi' });
  console.log(msg.message_id);
} catch (err) {
  console.error(err.message);
}
```

只入队、不等结果：

```js
await send.push(chatId, 'sendMessage', { text: 'hi' }, { wait: false });
```

---

## 发送方法

### sendMessage — 文本

```js
await send.push(chatId, 'sendMessage', {
  text: '<b>你好</b>',
  parse_mode: 'HTML',
});

await send.push(chatId, 'sendMessage', {
  text: '请选择：',
  reply_to_message_id: messageId,
  reply_markup: {
    inline_keyboard: [[{ text: '确认', callback_data: 'ok' }]],
  },
});
```

### sendPhoto — 图片

```js
await send.push(chatId, 'sendPhoto', {
  photo: fileId,       // file_id 或 URL
  caption: '说明文字',
  parse_mode: 'HTML',
});
```

### sendDocument — 文件

```js
await send.push(chatId, 'sendDocument', {
  document: fileId,
  caption: '文件名.pdf',
});
```

### sendVideo — 视频

```js
await send.push(chatId, 'sendVideo', {
  video: fileId,
  caption: '视频说明',
  supports_streaming: true,
});
```

### sendAudio — 音频

```js
await send.push(chatId, 'sendAudio', {
  audio: fileId,
  title: '歌名',
  performer: '歌手',
});
```

### sendVoice — 语音

```js
await send.push(chatId, 'sendVoice', {
  voice: fileId,
});
```

### sendSticker — 贴纸

```js
await send.push(chatId, 'sendSticker', {
  sticker: fileId,
});
```

### sendAnimation — GIF

```js
await send.push(chatId, 'sendAnimation', {
  animation: fileId,
  caption: '动图',
});
```

### sendLocation — 位置

```js
await send.push(chatId, 'sendLocation', {
  latitude: 39.9042,
  longitude: 116.4074,
});
```

### sendPoll — 投票

```js
await send.push(chatId, 'sendPoll', {
  question: '今天吃什么？',
  options: ['火锅', '烧烤', '麻辣烫'],
  is_anonymous: false,
});
```

### sendDice — 骰子 / 表情

```js
await send.push(chatId, 'sendDice', {
  emoji: '🎲',   // 可选：🎯 🏀 ⚽ 🎳 🎰，默认 🎲
});
```

### sendMediaGroup — 多图 / 多视频

```js
await send.push(chatId, 'sendMediaGroup', {
  media: [
    { type: 'photo', media: fileId1 },
    { type: 'photo', media: fileId2, caption: '图集说明' },
  ],
});
```

### sendChatAction — 输入状态

```js
await send.push(chatId, 'sendChatAction', { action: 'typing' });
// action 可选：typing | upload_photo | record_video | upload_video
//              record_voice | upload_voice | upload_document | find_location
await send.push(chatId, 'sendMessage', { text: '内容准备好了' });
```

---

## 编辑 / 操作

### editMessageText — 编辑文本

```js
await send.push(chatId, 'editMessageText', {
  message_id: 42,
  text: '已更新内容',
  parse_mode: 'HTML',
});
```

### editMessageCaption — 编辑图片说明

```js
await send.push(chatId, 'editMessageCaption', {
  message_id: 42,
  caption: '新的 caption',
});
```

### deleteMessage — 删除消息

```js
await send.push(chatId, 'deleteMessage', {
  message_id: 42,
});
```

### copyMessage — 复制消息

```js
await send.push(chatId, 'copyMessage', {
  from_chat_id: 123456,
  message_id: 42,
});
```

### forwardMessage — 转发消息

```js
await send.push(chatId, 'forwardMessage', {
  from_chat_id: 123456,
  message_id: 42,
});
```

---

## 其他 API

上面没列到的方法，直接写 grammY API 方法名即可（走 raw 兜底）：

```js
await send.push(chatId, 'sendVenue', {
  latitude: 39.9,
  longitude: 116.4,
  title: '地点名',
  address: '详细地址',
});
```

---

## 方法名速查

| 方法名 | 说明 |
|--------|------|
| `sendMessage` | 文本 |
| `sendPhoto` | 图片 |
| `sendDocument` | 文件 |
| `sendVideo` | 视频 |
| `sendAudio` | 音频 |
| `sendVoice` | 语音 |
| `sendSticker` | 贴纸 |
| `sendAnimation` | GIF |
| `sendLocation` | 位置 |
| `sendPoll` | 投票 |
| `sendDice` | 骰子 |
| `sendMediaGroup` | 媒体组 |
| `sendChatAction` | 输入状态 |
| `editMessageText` | 编辑文本 |
| `editMessageCaption` | 编辑 caption |
| `deleteMessage` | 删除消息 |
| `copyMessage` | 复制消息 |
| `forwardMessage` | 转发消息 |

---

## 多账户

`startWorker` 只调一次，用 `bots` 注册多个账户：

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

bot1.start();
bot2.start();
```

Worker 独立进程、无法传 JS 对象时，改用 `tokens`：

```js
startWorker({
  redis: process.env.REDIS_URL,
  tokens: { main: process.env.BOT_TOKEN_1, backup: process.env.BOT_TOKEN_2 },
  defaultBot: 'main',
});
```

## 防刷屏（v1.2）

防止某个用户疯狂点击占满队列、拖慢其他人：

```js
init({
  redis: process.env.REDIS_URL,
  maxPendingPerChat: 3,  // 单 chat 最多 3 条待发，超出 throw（code: QUEUE_FULL）
  dropOld: true,         // 同 chat 只发最新一条，旧的自动跳过
});
```

| 选项 | 默认 | 说明 |
|------|------|------|
| `maxPendingPerChat` | `3` | 单 chat 最大待发数，`0` = 不限制 |
| `dropOld` | `false` | 新消息覆盖旧的，适合进度刷新 |

Worker 公平调度：某 chat 在 1 秒冷却内**不会阻塞全局**，任务进延迟队列，先处理其他用户。

```js
try {
  await send.push(chatId, 'sendMessage', { text: 'hi' });
} catch (err) {
  if (err.code === 'QUEUE_FULL') {
    // 用户点太快了
  }
}
```

## CLI

```bash
BOT_TOKEN=xxx REDIS_URL=redis://127.0.0.1:6379 npx telegram-send-worker
```

## API

| 方法 | 说明 |
|------|------|
| `init({ redis, wait?, defaultBot?, maxPendingPerChat?, dropOld? })` | 初始化，入口调一次。重复调用不覆盖 |
| `send.push(chatId, method, params, opts?)` | 投递发送任务 |
| `send.close()` | 关闭 Redis 连接 |
| `startWorker({ redis, api?, bots?, tokens?, botToken?, defaultBot?, chatIntervalMs? })` | 启动 Worker |

## License

MIT
