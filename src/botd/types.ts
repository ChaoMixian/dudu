import type { DesktopConfig, DesktopStatus } from '../contracts';
import { botdRoot } from '../core/workspace';
export type { DesktopConfig, DesktopStatus } from '../contracts';
export const DEFAULT_ROOT = botdRoot();
export interface BotdOptions { root?: string; startupTimeoutMs?: number }
export interface ExecOptions { argv: string[]; cwd?: string; timeoutMs?: number; env?: Record<string,string> }
export interface ExecResult { code: number; stdout: string; stderr: string }
export interface WatchInfo { id: string; state: DesktopStatus['state']; url?: string; display?: string; port?: number; username?: string; password?: string; localOnly: true }
export interface RecordingInfo { id: string; path: string; startedAt: string }
export interface ProcessRecord { pid: number; startTicks: string; label: string }
export interface SavedDesktop { config: DesktopConfig; state: DesktopStatus['state']; display?: string; port?: number; error?: string; processes: ProcessRecord[]; password?: string; recording?: RecordingInfo }
export class BotdError extends Error { constructor(message: string, public status = 400) { super(message); this.name = 'BotdError'; } }
