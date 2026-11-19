import { Bell, CalendarDays, CloudSun, Mail, MessageCircle, Plug, Terminal, type LucideIcon } from 'lucide-react';

const icons: Record<string, LucideIcon> = {
  bark: Bell,
  weather: CloudSun,
  caldav: CalendarDays,
  outlook: Mail,
  weixin: MessageCircle,
  custom: Terminal,
};

export default function ProviderIcon({ providerId, className = '' }: { providerId?: string; className?: string }) {
  const Icon = icons[providerId ?? ''] ?? Plug;
  return <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl border border-separator bg-background/60 text-foreground/75 ${className}`} aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>;
}
