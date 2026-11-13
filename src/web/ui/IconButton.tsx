import { Button, Tooltip, type ButtonProps } from '@heroui/react';

export default function IconButton({ label, variant = 'ghost', size = 'sm', ...props }: Omit<ButtonProps, 'aria-label' | 'isIconOnly'> & { label: string }) {
  return (
    <Tooltip delay={450}>
      <Button isIconOnly aria-label={label} variant={variant} size={size} {...props} />
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}
