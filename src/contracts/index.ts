export type Priority = 'high' | 'normal' | 'low';
export type MessageKind = 'message' | 'ask' | 'reaction' | 'takeover' | 'bot_out' | 'bot_in';
export interface MessageAttachment { id: string; name: string; mime: string; size: number; url: string }
export interface WorkspaceEntry { name: string; path: string; type: 'file' | 'dir' | 'symlink' | 'other'; size: number; mtime: string; mime: string }
export interface UploadedWorkspaceFile { name: string; path: string; workPath?: string; size: number; mime: string }
export interface BotThreadMessage { id: string; from: string; to: string; text: string; createdAt: string }
export interface BotThread { botId: string; peerId: string; count: number; lastText: string; lastAt: string }
export type Route = { kind: 'web'; id: string } | { kind: 'bot'; id: string };
export type Delivery = 'wake' | 'digest' | 'ignore';
export interface EventInput { eventId?: string; sourceId: string; type: string; botId: string; priority?: Priority; payload: unknown; replyTo?: Route; correlationId?: string; dedupeKey?: string; delivery?: Delivery; wake?: boolean }
export interface DuduEvent extends Omit<EventInput, 'delivery' | 'wake'> { eventId: string; priority: Priority; seq: number; createdAt: string; delivery: Delivery }
export type InboxStatus = 'pending' | 'delivering' | 'completed' | 'failed' | 'cancelled';
export interface ComputerConfig { desktopId?: string; width?: number; height?: number; watchUrl?: string }
export interface BotConfig { id: string; name: string; description: string; avatar?: string; color?: string; provider?: string; model?: string; thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'; paused: boolean; computer: ComputerConfig }
export interface ProviderConfig { id: string; name?: string; baseUrl: string; api: 'openai-completions' | 'openai-responses' | 'anthropic-messages'; apiKey?: string; models: { id: string; name: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number }[] }
export interface UserProfile { name?: string; avatar?: string; avatarStyle?: string; avatarPreset?: string }
export interface GlobalConfig { host: string; port: number; token?: string; providers: ProviderConfig[]; defaultProvider?: string; defaultModel?: string; autoStartComputers?: boolean; advancedMode?: boolean; profile?: UserProfile }
export interface ConnectorTool { name: string; description: string; parameters: Record<string, unknown> }
export interface ConnectorDefinition { id: string; name: string; description: string; transport: 'command' | 'mcp' | 'http'; argv?: string[]; url?: string; env?: Record<string,string>; tools: ConnectorTool[] }
export interface SourceConfig { id: string; botId: string; kind: 'once' | 'interval' | 'cron' | 'process' | 'webhook'; enabled: boolean; priority: Priority; payload: unknown; at?: string; intervalMs?: number; cron?: string; argv?: string[]; env?: Record<string, string>; type?: string; timezone?: string }
export interface DesktopConfig { id: string; botId: string; width: number; height: number }
export interface DesktopStatus extends DesktopConfig { state: 'stopped' | 'starting' | 'ready' | 'error'; display?: string; port?: number; error?: string; watchUrl?: string }
export function id(value: unknown): string { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) throw new Error('Invalid identifier'); return value; }
export function object(value: unknown): Record<string, any> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object'); return value as Record<string, any>; }
export function text(value: unknown, name = 'text'): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be nonempty`); return value; }
export function eventInput(value: unknown): EventInput { const v = object(value); id(v.botId); text(v.sourceId, 'sourceId'); text(v.type, 'type'); if (v.priority && !['high','normal','low'].includes(v.priority)) throw new Error('Invalid priority'); if (v.replyTo) { if (!['web','bot'].includes(v.replyTo.kind)) throw new Error('Invalid reply route'); id(v.replyTo.id); } const delivery = v.delivery ?? (v.wake === false ? 'ignore' : 'wake'); if (!['wake','digest','ignore'].includes(delivery)) throw new Error('Invalid delivery'); return { eventId: v.eventId ? text(v.eventId) : undefined, botId:v.botId,sourceId:v.sourceId,type:v.type,priority:v.priority ?? 'normal',payload:v.payload ?? null,replyTo:v.replyTo,correlationId:v.correlationId,dedupeKey:v.dedupeKey,delivery }; }
