import { Button, Input, TextField } from '@heroui/react';
import { Plus, X } from 'lucide-react';
import { useI18n } from '../i18n';
import IconButton from './IconButton';

export default function ArgumentEditor({ value, onChange, disabled = false }: { value: string[]; onChange: (value: string[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return <section className="flex flex-col gap-2">
    <div className="flex items-center justify-between"><h3 className="text-sm font-medium">{t('gui.arguments')}</h3><Button size="sm" variant="ghost" isDisabled={disabled} onPress={() => onChange([...value, ''])}><Plus size={14} />{t('gui.add')}</Button></div>
    {value.map((argument, index) => <div className="flex items-center gap-2" key={index}>
      <TextField className="min-w-0 flex-1" aria-label={`${t('gui.argument')} ${index + 1}`} value={argument} isDisabled={disabled} onChange={text => onChange(value.map((entry, i) => i === index ? text : entry))}><Input /></TextField>
      <IconButton label={t('gui.remove')} isDisabled={disabled} onPress={() => onChange(value.filter((_, i) => i !== index))}><X size={16} /></IconButton>
    </div>)}
  </section>;
}
