import './style.css';
import { createOutlet, createProject, findWall, getActiveRoom } from './model/factory';
import { parseProject } from './model/migrate';
import { ProjectStore } from './model/store';
import { SCHEMA_VERSION, type Project } from './model/types';
import { createAutosaver, loadCurrentProject } from './storage/db';
import { exportProject, pickProjectFile } from './storage/file';
import { createJoystick } from './ui/joystick';
import { Panel } from './ui/panel';
import { Viewer } from './viewer/viewer';

async function loadInitialProject(): Promise<{ project: Project; restored: boolean; needsSave: boolean }> {
  try {
    const stored = await loadCurrentProject();
    if (stored) {
      const project = parseProject(stored);
      // Un projet converti depuis un ancien format est réenregistré dans le format courant.
      const needsSave = (stored as { schemaVersion?: number }).schemaVersion !== SCHEMA_VERSION;
      return { project, restored: true, needsSave };
    }
  } catch (err) {
    console.warn('Impossible de relire la sauvegarde locale, nouveau projet créé.', err);
  }
  return { project: createProject(), restored: false, needsSave: true };
}

async function main() {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <main class="viewport" id="viewport" aria-label="Vue 3D de la pièce">
      <div class="banner" hidden role="status">
        <span>Touchez un mur pour y placer la prise</span>
        <button type="button" class="small">Annuler</button>
      </div>
      <div class="visit-help" hidden role="status">
        <span class="hint-mouse"><b>ZQSD</b> se déplacer · <b>glisser</b> regarder · <b>Maj</b> courir · <b>Échap</b> quitter</span>
        <span class="hint-touch"><b>Joystick</b> se déplacer · <b>glisser</b> regarder</span>
        <button type="button" class="small">Quitter</button>
      </div>
    </main>
    <button type="button" class="panel-toggle" aria-controls="panel" aria-expanded="false">Réglages</button>
  `;

  // La vue est créée avant la lecture d'IndexedDB pour afficher la scène sans attendre.
  const viewport = document.getElementById('viewport')!;
  const viewer = new Viewer(viewport);
  const { project, restored, needsSave } = await loadInitialProject();
  const store = new ProjectStore(project);

  // ---------- Visite à pied ----------
  const visitHelp = viewport.querySelector<HTMLElement>('.visit-help')!;
  const joystick = createJoystick((x, y) => viewer.setJoystick(x, y));
  joystick.hidden = true;
  viewport.appendChild(joystick);
  visitHelp.querySelector('button')!.addEventListener('click', () => viewer.exitVisit());
  viewer.onModeChange((mode) => {
    const visiting = mode === 'visit';
    visitHelp.hidden = !visiting;
    joystick.hidden = !visiting || !matchMedia('(pointer: coarse)').matches;
    document.body.classList.toggle('visiting', visiting);
  });

  // ---------- Placement d'une prise en touchant un mur ----------
  const banner = viewport.querySelector<HTMLElement>('.banner')!;
  let placing = false;
  const setPlacing = (active: boolean) => {
    placing = active;
    banner.hidden = !active;
    viewer.setCursor(active ? 'crosshair' : '');
    panel.outlets.setPlacing(active);
  };
  banner.querySelector('button')!.addEventListener('click', () => setPlacing(false));
  viewer.onTap((hit) => {
    if (!placing) return;
    if (!hit) return; // touché à côté d'un mur : on reste en mode placement
    let id = '';
    store.update((p) => {
      const wall = findWall(getActiveRoom(p), hit.wallId);
      if (!wall) return;
      const outlet = createOutlet(wall, hit.u);
      id = outlet.id;
      wall.outlets.push(outlet);
    });
    setPlacing(false);
    if (id) panel.outlets.revealOutlet(id);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && placing) setPlacing(false);
  });

  const panel = new Panel(store, {
    onRecenter: () => viewer.frameRoom(getActiveRoom(store.project)),
    onTopView: () => viewer.frameTop(getActiveRoom(store.project)),
    onEyeView: () => {
      // Le focus quitte le bouton pour que les touches pilotent bien la visite.
      (document.activeElement as HTMLElement | null)?.blur();
      viewer.eyeLevelView();
    },
    onPlaceOutlet: () => setPlacing(!placing),
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
    viewer.setEyeHeight(p.settings.eyeHeight);
    viewer.setRoom(getActiveRoom(p));
    // Projet ouvert ou importé : on se place debout au centre de la pièce.
    if (source === 'load') viewer.eyeLevelView();
    if (source === 'user') autosaver.schedule(p);
  });

  viewer.setEyeHeight(store.project.settings.eyeHeight);
  viewer.setRoom(getActiveRoom(store.project));
  viewer.eyeLevelView();
  panel.setStatus(restored ? 'Projet restauré' : 'Nouveau projet', 'ok');
  if (needsSave) autosaver.schedule(store.project);

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
