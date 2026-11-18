import { useEffect } from 'react';

export const KEYBOARD_INSET = 120;

export function keyboardIsOpen(layoutHeight: number, visualHeight: number): boolean {
  return layoutHeight - visualHeight > KEYBOARD_INSET;
}

function isStandaloneDisplay(): boolean {
  const legacyStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia('(display-mode: standalone)').matches || legacyStandalone === true;
}

/**
 * Keep the app on the visual viewport while the keyboard is open in a standalone
 * PWA, where the layout viewport does not follow it. Safari already pans its own
 * visual viewport; overriding the height there fights the browser chrome and
 * makes the composer jump.
 */
export function useKeyboardViewport(): void {
  useEffect(() => {
    if (!isStandaloneDisplay()) return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let layoutHeight = Math.max(window.innerHeight, root.clientHeight);
    let frame = 0;

    const apply = (resetScroll: boolean) => {
      const currentLayout = Math.max(window.innerHeight, root.clientHeight);
      const open = keyboardIsOpen(layoutHeight, viewport.height);
      if (!open) layoutHeight = currentLayout;
      root.dataset.keyboard = open ? 'true' : 'false';
      if (!open) {
        root.style.removeProperty('--app-height');
        return;
      }
      root.style.setProperty('--app-height', `${Math.round(viewport.height + viewport.offsetTop)}px`);
      if (resetScroll) window.scrollTo(0, 0);
    };

    const schedule = (resetScroll: boolean) => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = 0; apply(resetScroll); });
    };
    const onResize = () => schedule(true);
    const onScroll = () => schedule(false);

    apply(true);
    viewport.addEventListener('resize', onResize);
    viewport.addEventListener('scroll', onScroll);
    window.addEventListener('resize', onResize);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', onResize);
      viewport.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      root.style.removeProperty('--app-height');
      delete root.dataset.keyboard;
    };
  }, []);
}
