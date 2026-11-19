import './style.css';
import { createProject, getActiveRoom } from './model/factory';
import { parseProject } from './model/migrate';
import { ProjectStore } from './model/store';
import type { Project } from './model/types';
import { createAutosaver, loadCurrentProject } from './storage/db';
import { exportProject, pickProjectFile } from './storage/file';
import { Panel } from './ui/panel';
import { Viewer } from './viewer/viewer';

async function loadInitialProject(): Promise<{ project: Project; restored: boolean }> {
  try {
    const stored = await loadCurrentProject();
    if (stored) return { project: parseProject(stored), restored: true };
  } catch (err) {
    console.warn('Impossible de relire la sauvegarde locale, nouveau projet créé.', err);
  }
  return { project: createProject(), restored: false };
}

async function main() {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <main class="viewport" id="viewport" aria-label="Vue 3D de la pièce"></main>
    <button type="button" class="panel-toggle" aria-controls="panel" aria-expanded="false">Réglages</button>
  `;

  // La vue est créée avant la lecture d'IndexedDB pour afficher la scène sans attendre.
  const viewer = new Viewer(document.getElementById('viewport')!);
  const { project, restored } = await loadInitialProject();
  const store = new ProjectStore(project);

  const panel = new Panel(store, {
    onRecenter: () => viewer.frameRoom(getActiveRoom(store.project)),
    onExport: () => exportProject(store.project),
    onImport: async () => {
      try {
        const imported = await pickProjectFile();
        if (!imported) return;
        if (!confirm(`Remplacer le projet en cours par « ${imported.name} » ?`)) return;
        store.replace(imported);
        autosaver.schedule(store.project);
      } catch (err) {
        alert(`Import impossible : ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    onNewProject: () => {
      if (!confirm('Créer un nouveau projet ? Pensez à exporter le projet actuel si vous voulez le garder.')) return;
      store.replace(createProject());
      autosaver.schedule(store.project);
    },
  });
  app.appendChild(panel.el);

  const autosaver = createAutosaver(400, (status, err) => {
    if (status === 'pending') panel.setStatus('Enregistrement…', 'pending');
    else if (status === 'saved') panel.setStatus('Enregistré', 'ok');
    else {
      console.error(err);
      panel.setStatus('Échec de la sauvegarde', 'error');
    }
  });

  store.subscribe((p, source) => {
    viewer.setRoom(getActiveRoom(p), { reframe: source === 'load' });
    if (source === 'user') autosaver.schedule(p);
  });

  viewer.setRoom(getActiveRoom(store.project), { reframe: true });
  panel.setStatus(restored ? 'Projet restauré' : 'Nouveau projet', 'ok');
  if (!restored) autosaver.schedule(store.project);

  // Sur mobile, l'appli peut être tuée en arrière-plan : on écrit immédiatement en quittant.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void autosaver.flush();
  });
  window.addEventListener('pagehide', () => void autosaver.flush());

  // Demande au navigateur de ne pas purger les données locales (utile sur Android).
  void navigator.storage?.persist?.();

  setupPanelToggle(panel.el, app.querySelector<HTMLButtonElement>('.panel-toggle')!);
}

/** Sur petit écran, le panneau devient un tiroir en bas de l'écran. */
function setupPanelToggle(panelEl: HTMLElement, toggle: HTMLButtonElement) {
  const setOpen = (open: boolean) => {
    // La classe sur <body> réduit la vue 3D au-dessus du tiroir pour garder la pièce visible.
    document.body.classList.toggle('panel-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Fermer' : 'Réglages';
  };
  toggle.addEventListener('click', () => setOpen(!document.body.classList.contains('panel-open')));
  panelEl.querySelector('.panel-handle')?.addEventListener('click', () => setOpen(false));
}

void main();
