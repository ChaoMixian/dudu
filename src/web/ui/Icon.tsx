import {
  ArrowUp, AudioLines, Braces, Check, ChevronRight, CircleHelp, Clock3, Container, Copy, FileArchive, FileCode2, FileText, Folder, FolderPlus, GitBranch, Globe2, Maximize2,
  Download, Hash, Image, LayoutGrid, Link2, LogOut, MessageCircle, Mic, Monitor, Moon, MoreHorizontal, PanelLeft, PanelRight,
  Paperclip, Pause, Pin, Play, Plus, Plug, RefreshCw, Reply, ScrollText, Search, Settings2, SlidersHorizontal, SmilePlus,
  Sparkles, Square, SquarePen, Sun, Terminal, Trash2, Upload, UserRound, Workflow, X,
  type LucideProps,
} from 'lucide-react';

const icons = {
  plus: Plus, search: Search, sidebar: PanelLeft, panelRight: PanelRight, edit: SquarePen, image: Image,
  clock: Clock3, grid: LayoutGrid, settings: Settings2, chevron: ChevronRight,
  close: X, more: MoreHorizontal, monitor: Monitor, arrowUp: ArrowUp, mic: Mic,
  wave: AudioLines, check: Check, refresh: RefreshCw, logout: LogOut, globe: Globe2,
  chat: MessageCircle, pin: Pin, copy: Copy, play: Play, pause: Pause,
  stop: Square, workflow: Workflow, plug: Plug, sparkles: Sparkles,
  sliders: SlidersHorizontal, help: CircleHelp, sun: Sun, moon: Moon, reply: Reply, smile: SmilePlus, user: UserRound,
  file: FileText, download: Download, folder: Folder, folderPlus: FolderPlus, terminal: Terminal,
  session: ScrollText, paperclip: Paperclip, trash: Trash2, upload: Upload,
  braces: Braces, fileCode: FileCode2, fileArchive: FileArchive, container: Container,
  gitBranch: GitBranch, hash: Hash, link: Link2, expand: Maximize2,
};

export type IconName = keyof typeof icons;

export default function Icon({ name, size = 20, ...props }: LucideProps & { name: IconName }) {
  const Component = icons[name];
  return <Component size={size} strokeWidth={1.8} aria-hidden="true" {...props} />;
}
