import './style.css';
import { addProfilePoint, createOutlet, createProject, findWall, getActiveRoom } from './model/factory';
import { parseProject } from './model/migrate';
import { ProjectStore } from './model/store';
import { SCHEMA_VERSION, type Project } from './model/types';
import { createAutosaver, loadCurrentProject } from './storage/db';
import { exportProject, pickProjectFile } from './storage/file';
import { createJoystick } from './ui/joystick';
import { ITEM_FOCUS_EVENT, type ItemFocusDetail } from './ui/list-section';
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

/** Mode « toucher un mur » : poser une prise ou un sommet du haut du mur. */
type Placing = null | 'outlet' | 'vertex';
const PLACING_TEXT: Record<Exclude<Placing, null>, string> = {
  outlet: 'Touchez un mur pour y placer la prise',
  vertex: 'Touchez un mur à l’endroit du nouveau sommet',
};

async function main() {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <main class="viewport" id="viewport" aria-label="Vue 3D de la pièce">
      <div class="banner" hidden role="status">
        <span class="banner-text"></span>
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

  // ---------- Toucher un mur pour poser une prise ou un sommet ----------
  const banner = viewport.querySelector<HTMLElement>('.banner')!;
  let placing: Placing = null;
  const setPlacing = (mode: Placing) => {
    placing = mode;
    banner.hidden = !mode;
    if (mode) banner.querySelector('.banner-text')!.textContent = PLACING_TEXT[mode];
    viewer.setCursor(mode ? 'crosshair' : '');
    panel.outlets.setPlacing(mode === 'outlet');
  };
  banner.querySelector('button')!.addEventListener('click', () => setPlacing(null));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && placing) setPlacing(null);
  });

  viewer.onTap((pick) => {
    if (placing) {
      if (!pick?.wallId || pick.u === undefined || pick.y === undefined) return; // à côté d'un mur : on reste en mode
      const { wallId, u, y } = pick;
      const mode = placing;
      store.update((p) => {
        const room = getActiveRoom(p);
        const wall = findWall(room, wallId);
        if (!wall) return;
        if (mode === 'outlet') wall.outlets.push(createOutlet(wall, u));
        else addProfilePoint(room, wall, u, y);
      });
      setPlacing(null);
      const created = findWall(getActiveRoom(store.project), wallId);
      const outlet = mode === 'outlet' ? created?.outlets[created.outlets.length - 1] : undefined;
      select(outlet ? { kind: 'outlet', id: outlet.id } : { kind: 'wall', id: wallId });
      return;
    }
    select(pick?.selection ?? null);
  });

  /** Sélection : contour en 3D, fiche ouverte dans le panneau (et tiroir ouvert sur téléphone). */
  const select = (selection: Parameters<Viewer['setSelection']>[0]) => {
    viewer.setSelection(selection);
    panel.select(selection);
    if (selection && isDrawer()) setDrawerOpen(true);
  };

  const panel = new Panel(store, {
    onRecenter: () => viewer.frameRoom(getActiveRoom(store.project)),
    onTopView: () => viewer.frameTop(getActiveRoom(store.project)),
    onEyeView: () => {
      // Le focus quitte le bouton pour que les touches pilotent bien la visite.
      (document.activeElement as HTMLElement | null)?.blur();
      viewer.eyeLevelView();
    },
    onPlaceOutlet: () => setPlacing(placing === 'outlet' ? null : 'outlet'),
    onPickPoint: () => {
      setPlacing('vertex');
      // Sur téléphone, on referme le tiroir pour dégager la vue.
      if (isDrawer()) setDrawerOpen(false);
    },
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

  // Travail dans une fiche du panneau : l'élément correspondant est entouré dans la vue 3D.
  panel.el.addEventListener(ITEM_FOCUS_EVENT, (e) => {
    const { kind, id, pointId } = (e as CustomEvent<ItemFocusDetail>).detail;
    viewer.setSelection(kind === 'wall' ? { kind, id, pointId } : { kind, id });
  });

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
    if (source === 'load') {
      select(null);
      viewer.eyeLevelView();
    }
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

  const setDrawerOpen = setupPanelToggle(panel.el, app.querySelector<HTMLButtonElement>('.panel-toggle')!);
}

/** Le panneau est-il un tiroir (petit écran) plutôt qu'une colonne ? */
function isDrawer(): boolean {
  return matchMedia('(max-width: 720px)').matches;
}

/** Sur petit écran, le panneau devient un tiroir en bas de l'écran. */
function setupPanelToggle(panelEl: HTMLElement, toggle: HTMLButtonElement): (open: boolean) => void {
  const setOpen = (open: boolean) => {
    // La classe sur <body> réduit la vue 3D au-dessus du tiroir pour garder la pièce visible.
    document.body.classList.toggle('panel-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Fermer' : 'Réglages';
  };
  toggle.addEventListener('click', () => setOpen(!document.body.classList.contains('panel-open')));
  panelEl.querySelector('.panel-handle')?.addEventListener('click', () => setOpen(false));
  return setOpen;
}

void main();
