import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Portable default: never bake the author's absolute home path into the project. */
export const DEFAULT_WORKSPACE = join(homedir(), 'Workspace');

export function workspaceRoot(value = process.env.DUDU_WORKSPACE): string {
  return resolve(value ?? DEFAULT_WORKSPACE);
}

export function botdRoot(workspace = workspaceRoot(), value = process.env.DUDU_BOTD_ROOT): string {
  return resolve(value ?? join(workspace, '.dudu', 'botd'));
}
