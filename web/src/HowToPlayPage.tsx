import type { JSX } from 'preact';
import { PastureTutorialGame } from './PastureTutorialGame';
import './howToPlay.css';

export function HowToPlayPage({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <article class="how-to-play" aria-label="Guided pasture tutorial">
      <PastureTutorialGame onExit={onBack} />
    </article>
  );
}
