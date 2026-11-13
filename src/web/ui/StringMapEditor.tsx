import { Button, Input, Label, TextField } from '@heroui/react';
import { Plus, X } from 'lucide-react';
import { useI18n } from '../i18n';
import IconButton from './IconButton';

export interface StringEntry { key: string; value: string }
export const mapEntries = (value?: Record<string, string>): StringEntry[] => Object.entries(value ?? {}).map(([key, value]) => ({ key, value }));
export function entriesMap(entries: StringEntry[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of entries) {
    if (!row.key.trim()) throw new Error('Each field needs a name.');
    if (Object.hasOwn(result, row.key.trim())) throw new Error(`Duplicate field: ${row.key}`);
    Object.defineProperty(result, row.key.trim(), { value: row.value, enumerable: true, configurable: true, writable: true });
  }
  return result;
}
export default function StringMapEditor({ label, value, onChange, disabled = false }: { label: string; value: StringEntry[]; onChange: (value: StringEntry[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return <section className="flex flex-col gap-2">
    <div className="flex items-center justify-between"><h3 className="text-sm font-medium">{label}</h3><Button size="sm" variant="ghost" isDisabled={disabled} onPress={() => onChange([...value, { key: '', value: '' }])}><Plus size={14} />{t('gui.add')}</Button></div>
    {value.map((row, index) => <div className="flex items-end gap-2" key={index}>
      <TextField className="min-w-0 flex-1" value={row.key} isDisabled={disabled} onChange={key => onChange(value.map((entry, i) => i === index ? { ...entry, key } : entry))}><Label>{t('gui.key')}</Label><Input /></TextField>
      <TextField className="min-w-0 flex-1" value={row.value} isDisabled={disabled} onChange={text => onChange(value.map((entry, i) => i === index ? { ...entry, value: text } : entry))}><Label>{t('gui.value')}</Label><Input /></TextField>
      <IconButton label={t('gui.remove')} isDisabled={disabled} onPress={() => onChange(value.filter((_, i) => i !== index))}><X size={16} /></IconButton>
    </div>)}
  </section>;
}
