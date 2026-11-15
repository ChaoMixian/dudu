import type { DesktopStatus } from '../../contracts';
import { fetchBlob, request, segment } from './api';

export type ComputerAction = 'start' | 'stop' | 'takeover';
export interface ComputerWatch { url?: string; proxyUrl?: string }

function computerPath(botId: string, action: string) {
  return `/bots/${segment(botId)}/computer/${action}`;
}

/** Read the actual desktop state, not the application's cached snapshot. */
export function computerStatus(token: string, botId: string, signal?: AbortSignal) {
  return request<DesktopStatus>(token, computerPath(botId, 'status'), 'GET', undefined, signal);
}

/** The server parses every computer POST as a JSON object, including no-argument actions. */
export function computerAction(token: string, botId: string, action: ComputerAction, signal?: AbortSignal) {
  return request<ComputerWatch>(token, computerPath(botId, action), 'POST', {}, signal);
}

export function computerWatch(token: string, botId: string, signal?: AbortSignal) {
  return request<ComputerWatch>(token, computerPath(botId, 'watch'), 'POST', {}, signal);
}

export function computerShot(token: string, botId: string, signal?: AbortSignal) {
  return fetchBlob(token, computerPath(botId, 'shot'), signal);
}
