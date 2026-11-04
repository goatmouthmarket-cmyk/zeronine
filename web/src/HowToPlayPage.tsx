import type { JSX } from 'preact';
import { PastureTutorialGame } from './PastureTutorialGame';
import './howToPlay.css';

export function HowToPlayPage({ onBack, onConnect }: { onBack: () => void; onConnect: () => void }): JSX.Element {
  return (
    <article class="how-to-play" aria-label="Guided pasture tutorial">
      <PastureTutorialGame onExit={onBack} onConnect={onConnect} />
    </article>
  );
}
