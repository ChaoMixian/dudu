import { useEffect, useState, type CSSProperties } from 'react';
import { dicebearDataUri } from '../lib/bot-theme';
import { randomId } from '../lib/random';

type Meteor = {
  id: string;
  src: string;
  top: number;
  size: number;
  drift: number;
  duration: number;
  reverse: boolean;
};

const CHANCE = 0.045;
const INTERVAL = 1200;

export default function SetupMeteors() {
  const [meteors, setMeteors] = useState<Meteor[]>([]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const interval = window.setInterval(() => {
      if (Math.random() > CHANCE) return;
      setMeteors(current => {
        if (current.length >= 2) return current;
        const id = randomId();
        const duration = 1600 + Math.random() * 900;
        const meteor: Meteor = {
          id,
          src: dicebearDataUri(randomId().slice(0, 10), 96),
          top: 4 + Math.random() * 72,
          size: 24 + Math.random() * 16,
          drift: (Math.random() - 0.5) * 36,
          duration,
          reverse: Math.random() > 0.72,
        };
        return [...current, meteor];
      });
    }, INTERVAL);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="setup-meteors" aria-hidden="true">
      {meteors.map(meteor => (
        <span
          className="setup-meteor"
          data-direction={meteor.reverse ? 'rtl' : 'ltr'}
          key={meteor.id}
          onAnimationEnd={() => setMeteors(current => current.filter(item => item.id !== meteor.id))}
          style={{
            '--meteor-top': `${meteor.top}%`,
            '--meteor-size': `${meteor.size}px`,
            '--meteor-drift': `${meteor.drift}vh`,
            '--meteor-duration': `${meteor.duration}ms`,
          } as CSSProperties}
        >
          <img src={meteor.src} alt="" draggable={false} />
        </span>
      ))}
    </div>
  );
}
