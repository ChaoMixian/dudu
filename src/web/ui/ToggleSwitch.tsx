import { Label, Switch } from '@heroui/react';

export default function ToggleSwitch({ checked, disabled, label, onChange }: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Switch isSelected={checked} isDisabled={disabled} onChange={onChange} aria-label={label}>
      <Switch.Content>
        <Switch.Control><Switch.Thumb /></Switch.Control>
        <Label className="sr-only">{label}</Label>
      </Switch.Content>
    </Switch>
  );
}
