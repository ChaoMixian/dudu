import {
  ArrowUp, AudioLines, Check, ChevronRight, CircleHelp, Clock3, Copy, Globe2,
  Download, FileText, Image, LayoutGrid, LogOut, MessageCircle, Mic, Monitor, Moon, MoreHorizontal, PanelLeft,
  Pause, Pin, Play, Plus, Plug, RefreshCw, Reply, Search, Settings2, SlidersHorizontal, SmilePlus,
  Sparkles, Square, SquarePen, Sun, Workflow, X,
  type LucideProps,
} from 'lucide-react';

const icons = {
  plus: Plus, search: Search, sidebar: PanelLeft, edit: SquarePen, image: Image,
  clock: Clock3, grid: LayoutGrid, settings: Settings2, chevron: ChevronRight,
  close: X, more: MoreHorizontal, monitor: Monitor, arrowUp: ArrowUp, mic: Mic,
  wave: AudioLines, check: Check, refresh: RefreshCw, logout: LogOut, globe: Globe2,
  chat: MessageCircle, pin: Pin, copy: Copy, play: Play, pause: Pause,
  stop: Square, workflow: Workflow, plug: Plug, sparkles: Sparkles,
  sliders: SlidersHorizontal, help: CircleHelp, sun: Sun, moon: Moon, reply: Reply, smile: SmilePlus,
  file: FileText, download: Download,
};

export type IconName = keyof typeof icons;

export default function Icon({ name, size = 20, ...props }: LucideProps & { name: IconName }) {
  const Component = icons[name];
  return <Component size={size} strokeWidth={1.8} aria-hidden="true" {...props} />;
}
