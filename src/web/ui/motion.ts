export const spring = { type: 'spring', stiffness: 420, damping: 36, mass: 0.8 } as const;
export const easeOut = [0.22, 1, 0.36, 1] as const;
export const quickTransition = { duration: 0.18, ease: easeOut } as const;
