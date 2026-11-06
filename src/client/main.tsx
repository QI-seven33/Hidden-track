import { createRoot } from 'react-dom/client';
import './styles.css';
import './presentation/theme.css';
import './legacy/index.css';
import './duel-interactions.css';
import { App } from './App';
import './presentation/motion.css';
import './presentation/feedback.css';
import './manga.css';
import './cards-090.css';
import './music-duel.css';
import './music-duel-integration.css';
import './rotate.css';
import { installStageMetrics } from './stage';
import { mobileWebRedirect } from './mobile-web';

const download = mobileWebRedirect(navigator);
if (download) {
  // Replace the game entry so Back does not bounce between it and downloads.
  window.location.replace(download);
} else {
  installStageMetrics();
  createRoot(document.getElementById('root')!).render(<App />);
}
