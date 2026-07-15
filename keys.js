export const QUEUE_KEY = 'tg:send:queue';
export const DELAY_KEY = 'tg:send:delay';
export const DONE_PREFIX = 'tg:send:done:';
export const PENDING_PREFIX = 'tg:send:pending:';
export const LATEST_PREFIX = 'tg:send:latest:';
export const CONFIG_KEY = 'tg:send:config';

export const DONE_TTL_SEC = 60;
export const DEFAULT_MAX_PENDING_PER_CHAT = 3;

export function pendingKey(bot, chatId) {
  return `${PENDING_PREFIX}${bot}:${chatId}`;
}

export function latestKey(bot, chatId) {
  return `${LATEST_PREFIX}${bot}:${chatId}`;
}

export function doneKey(taskId) {
  return `${DONE_PREFIX}${taskId}`;
}
