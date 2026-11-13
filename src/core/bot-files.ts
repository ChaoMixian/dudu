import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BotConfig } from '../contracts';

/** Content of AGENTS.md, the Bot's operating instructions. */
export function agentsMarkdown(bot: Pick<BotConfig, 'name' | 'description'>): string {
  const description = bot.description.trim();
  return `# ${bot.name}\n${description ? `\n${description}\n` : ''}
## Replying

Use message_send for every user-visible response. Agent text is not delivered. Respect explicit reply routes.
If a request is complex or needs several steps, send a brief message_send reply first, then do the work, so the user is not left waiting.

## Bot-to-bot

At most 20 automatic messages per pair after the last human message; beyond that, stored messages do not wake the peer. message_send results and incoming bot events report remaining budget; at 0, stop and ask the human to continue.
`;
}

/** Content of MEMORY.md, the Bot's long-term notes. */
export function memoryMarkdown(): string {
  return '# Memory\n';
}

/** Create the context files a Bot needs, without touching files that already exist. */
export function ensureBotFiles(path: string, bot: Pick<BotConfig, 'name' | 'description'>): void {
  const files: [name: string, content: string][] = [
    ['AGENTS.md', agentsMarkdown(bot)],
    ['MEMORY.md', memoryMarkdown()],
  ];
  for (const [name, content] of files) {
    const file = join(path, name);
    if (!existsSync(file)) writeFileSync(file, content);
  }
}
