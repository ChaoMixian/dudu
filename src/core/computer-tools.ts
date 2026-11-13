// Single source of truth for the cua-aligned computer-use tool surface.
// Agent tools call Computer.cua(); the web UI uses Computer.call() for lifecycle and live view.

const N = { type: 'number' } as const;
const B = { type: 'boolean' } as const;
const STR = { type: 'string' } as const;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const key = { type: 'string' } as const;
const path = { type: 'string' } as const;
const xy = (extra: Record<string, unknown> = {}, req: string[] = ['x', 'y']) => obj({ x: N, y: N, ...extra }, req);

export const computerTools = [
  { name: 'status', description: 'Current desktop state (stopped, starting, ready, error), display and stream port.', parameters: obj({}) },
  { name: 'start', description: 'Start this Bot\'s desktop when it is stopped. Returns the desktop status.', parameters: obj({}) },
  { name: 'stop', description: 'Stop the desktop and end its running apps and terminal sessions.', parameters: obj({}) },
  { name: 'screenshot', description: 'Capture the screen; returns an image content block.', parameters: obj({ format: STR, quality: N, x: N, y: N, width: N, height: N, max_dimension: N, include_cursor: B }) },
  { name: 'screen_size', description: 'Screen size in pixels.', parameters: obj({}) },
  { name: 'displays', description: 'List displays.', parameters: obj({}) },
  { name: 'click', description: 'Click at (x, y); button left|middle|right.', parameters: xy({ button: STR }) },
  { name: 'double_click', description: 'Double click at (x, y).', parameters: xy() },
  { name: 'right_click', description: 'Right click at (x, y).', parameters: xy() },
  { name: 'move', description: 'Move the pointer to (x, y).', parameters: xy() },
  { name: 'drag', description: 'Drag from (start_x, start_y) to (end_x, end_y).', parameters: obj({ start_x: N, start_y: N, end_x: N, end_y: N, button: STR }, ['start_x', 'start_y', 'end_x', 'end_y']) },
  { name: 'scroll', description: 'Scroll scroll_x/scroll_y rows at (x, y); positive y scrolls down.', parameters: xy({ scroll_x: N, scroll_y: N }, []) },
  { name: 'mouse_down', description: 'Press and hold a mouse button.', parameters: obj({ button: STR }) },
  { name: 'mouse_up', description: 'Release a mouse button.', parameters: obj({ button: STR }) },
  { name: 'key_down', description: 'Press and hold a key.', parameters: obj({ key }, ['key']) },
  { name: 'key_up', description: 'Release a key.', parameters: obj({ key }, ['key']) },
  { name: 'keypress', description: 'Press a key combination, e.g. ["ctrl","c"] or "ctrl+c".', parameters: obj({ keys: { type: 'array', items: STR } }) },
  { name: 'type', description: 'Type text (clipboard path; reliable for non-ASCII).', parameters: obj({ text: STR }, ['text']) },
  { name: 'cursor_position', description: 'Current pointer position.', parameters: obj({}) },
  { name: 'clipboard_get', description: 'Read clipboard text.', parameters: obj({}) },
  { name: 'clipboard_set', description: 'Write clipboard text.', parameters: obj({ text: STR }, ['text']) },
  { name: 'run', description: 'Run a shell command in the desktop session; background=true returns a pid.', parameters: obj({ command: STR, timeout: N, background: B }, ['command']) },
  { name: 'process_list', description: 'List background processes.', parameters: obj({}) },
  { name: 'process_read', description: 'Read captured output of a background process.', parameters: obj({ pid: N }, ['pid']) },
  { name: 'process_kill', description: 'Kill a background process.', parameters: obj({ pid: N }, ['pid']) },
  { name: 'terminal_create', description: 'Create an interactive PTY terminal session.', parameters: obj({ command: STR, cols: N, rows: N }) },
  { name: 'terminal_send', description: 'Send input to a PTY session.', parameters: obj({ pid: N, data: STR }, ['pid', 'data']) },
  { name: 'terminal_read', description: 'Read new output of a PTY session since the last read.', parameters: obj({ pid: N }, ['pid']) },
  { name: 'terminal_info', description: 'Info about a PTY session.', parameters: obj({ pid: N }, ['pid']) },
  { name: 'terminal_close', description: 'Close a PTY session.', parameters: obj({ pid: N }, ['pid']) },
  { name: 'window_list', description: 'List visible windows with titles.', parameters: obj({}) },
  { name: 'window_active_title', description: 'Title of the active window.', parameters: obj({}) },
  { name: 'window_activate', description: 'Activate a window by id.', parameters: obj({ id: N }, ['id']) },
  { name: 'files_read_text', description: 'Read a text file (absolute path, same-UID filesystem).', parameters: obj({ path }, ['path']) },
  { name: 'files_write_text', description: 'Write a text file.', parameters: obj({ path, content: STR }, ['path', 'content']) },
  { name: 'files_read_bytes', description: 'Read file bytes (base64) with optional offset/length.', parameters: obj({ path, offset: N, length: N }, ['path']) },
  { name: 'files_write_bytes', description: 'Write file bytes (base64).', parameters: obj({ path, data_base64: STR }, ['path', 'data_base64']) },
  { name: 'files_list', description: 'List a directory.', parameters: obj({ path }, ['path']) },
  { name: 'files_make_dir', description: 'Create a directory (recursive).', parameters: obj({ path }, ['path']) },
  { name: 'files_remove', description: 'Remove a file.', parameters: obj({ path }, ['path']) },
  { name: 'files_remove_dir', description: 'Remove a directory (recursive).', parameters: obj({ path }, ['path']) },
  { name: 'files_exists', description: 'Check path existence.', parameters: obj({ path }, ['path']) },
  { name: 'files_is_dir', description: 'Check if path is a directory.', parameters: obj({ path }, ['path']) },
  { name: 'files_size', description: 'File size in bytes.', parameters: obj({ path }, ['path']) },
] as const;
