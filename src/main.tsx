import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import LicenseGate from './license/LicenseGate';
import UpdateBar from './update/UpdateBar';
import { loadGallerySite } from './studio/galleryShare';
import './index.css';
/* Desktop-only behaviour (no text caret on labels, the top bar as the window's
 * title bar, no browser drag ghosts). Every rule inside is scoped to an
 * attribute only the installed app sets, so in the browser this import changes
 * nothing. See src/design/desktop.css. */
import './design/desktop.css';

// The client-gallery link is built from the website's address; ask for it now so
// the first gallery screen already has it. Never blocks the first paint.
void loadGallerySite();

// Ctrl+wheel and a touchpad pinch (which arrives as Ctrl+wheel) zoom the whole
// interface, not the photo. The installed app resets that in electron/main.cjs;
// in the browser the page has to refuse it itself. The photo viewers still get
// the event and zoom the photo.
window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LicenseGate><App /></LicenseGate>
    <UpdateBar />
  </React.StrictMode>,
);
