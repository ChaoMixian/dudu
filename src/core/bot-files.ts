import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BotConfig } from '../contracts';

/** Content of BOTS.md, the Bot's persistent identity. */
export function botsMarkdown(bot: Pick<BotConfig, 'name' | 'description'>): string {
  const description = bot.description.trim();
  return `# ${bot.name}\n${description ? `\n${description}\n` : ''}`;
}

/** Content of MEMORY.md, the Bot's long-term notes. */
export function memoryMarkdown(): string {
  return '# Memory\n';
}

/** Keep BOTS.md in sync with the Bot identity; MEMORY.md is owned by the Bot. */
export function ensureBotFiles(path: string, bot: Pick<BotConfig, 'name' | 'description'>): void {
  const bots = join(path, 'BOTS.md');
  const content = botsMarkdown(bot);
  if (!existsSync(bots) || readFileSync(bots, 'utf8') !== content) writeFileSync(bots, content);
  const memory = join(path, 'MEMORY.md');
  if (!existsSync(memory)) writeFileSync(memory, memoryMarkdown());
}
