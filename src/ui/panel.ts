import type { Project, Room } from '../model/types';
import { ROOM_LIMITS, clamp, getActiveRoom } from '../model/factory';
import type { ProjectStore } from '../model/store';

export interface PanelActions {
  onRecenter(): void;
  onExport(): void;
  onImport(): void;
  onNewProject(): void;
}

type DimKey = 'length' | 'width' | 'height';

const DIM_FIELDS: { key: DimKey; label: string }[] = [
  { key: 'length', label: 'Longueur' },
  { key: 'width', label: 'Largeur' },
  { key: 'height', label: 'Hauteur' },
];

const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

function numberField(id: string, label: string, min: number, max: number): string {
  return `
    <label class="field" for="${id}">
      <span>${label}</span>
      <span class="input-unit">
        <input id="${id}" type="number" inputmode="decimal" min="${min}" max="${max}" step="1" required />
        <span class="unit">cm</span>
      </span>
    </label>`;
}

export class Panel {
  readonly el: HTMLElement;
  private statusEl!: HTMLElement;
  private summaryEl!: HTMLElement;

  constructor(
    private store: ProjectStore,
    actions: PanelActions,
  ) {
    this.el = document.createElement('aside');
    this.el.className = 'panel';
    this.el.id = 'panel';
    this.el.setAttribute('aria-label', 'Paramètres du projet');
    this.el.innerHTML = `
      <div class="panel-handle" aria-hidden="true"></div>
      <header class="panel-header">
        <h1>Atelier 3D</h1>
        <span class="status" role="status" aria-live="polite"></span>
      </header>

      <section>
        <h2>Projet</h2>
        <label class="field" for="project-name">
          <span>Nom</span>
          <input id="project-name" type="text" maxlength="80" autocomplete="off" />
        </label>
      </section>

      <section>
        <h2>Pièce</h2>
        <label class="field" for="room-name">
          <span>Nom</span>
          <input id="room-name" type="text" maxlength="80" autocomplete="off" />
        </label>
        ${DIM_FIELDS.map((f) => numberField(`room-${f.key}`, f.label, ROOM_LIMITS[f.key].min, ROOM_LIMITS[f.key].max)).join('')}
        ${numberField('wall-thickness', 'Épaisseur des murs', ROOM_LIMITS.thickness.min, ROOM_LIMITS.thickness.max)}
        <p class="summary"></p>
      </section>

      <section class="actions">
        <h2>Fichier</h2>
        <button type="button" data-action="export">Exporter (JSON)</button>
        <button type="button" data-action="import">Importer…</button>
        <button type="button" data-action="new" class="danger">Nouveau projet</button>
      </section>

      <section class="actions">
        <h2>Vue</h2>
        <button type="button" data-action="recenter">Recentrer la vue</button>
        <p class="hint">
          <span class="hint-mouse">Souris : clic gauche pour tourner, clic droit pour déplacer, molette pour zoomer.</span>
          <span class="hint-touch">Tactile : un doigt pour tourner, deux doigts pour zoomer et déplacer.</span>
        </p>
      </section>
    `;

    this.statusEl = this.el.querySelector('.status')!;
    this.summaryEl = this.el.querySelector('.summary')!;

    const handlers: Record<string, () => void> = {
      export: actions.onExport,
      import: actions.onImport,
      new: actions.onNewProject,
      recenter: actions.onRecenter,
    };
    this.el.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => handlers[btn.dataset.action!]());
    });

    this.bindText('project-name', (p, v) => (p.name = v), (p) => p.name);
    this.bindText('room-name', (p, v) => (getActiveRoom(p).name = v), (p) => getActiveRoom(p).name);
    for (const f of DIM_FIELDS) {
      this.bindNumber(`room-${f.key}`, ROOM_LIMITS[f.key], (room, v) => (room[f.key] = v), (room) => room[f.key]);
    }
    this.bindNumber(
      'wall-thickness',
      ROOM_LIMITS.thickness,
      (room, v) => room.walls.forEach((w) => (w.thickness = v)),
      (room) => room.walls[0].thickness,
    );

    store.subscribe((project, source) => {
      if (source === 'load') this.fill(project);
      this.updateSummary(getActiveRoom(project));
    });
    this.fill(store.project);
  }

  setStatus(text: string, kind: 'ok' | 'pending' | 'error' = 'ok'): void {
    this.statusEl.textContent = text;
    this.statusEl.dataset.kind = kind;
  }

  /** Recopie le projet dans les champs (au chargement ou après un import). */
  private fill(project: Project): void {
    const room = getActiveRoom(project);
    this.input('project-name').value = project.name;
    this.input('room-name').value = room.name;
    for (const f of DIM_FIELDS) this.input(`room-${f.key}`).value = String(room[f.key]);
    this.input('wall-thickness').value = String(room.walls[0].thickness);
    this.updateSummary(room);
  }

  private updateSummary(room: Room): void {
    const surface = (room.length * room.width) / 10000;
    const volume = (room.length * room.width * room.height) / 1e6;
    this.summaryEl.textContent = `Surface au sol : ${fmt.format(surface)} m² · Volume : ${fmt.format(volume)} m³`;
  }

  private input(id: string): HTMLInputElement {
    return this.el.querySelector<HTMLInputElement>(`#${id}`)!;
  }

  private bindText(id: string, set: (p: Project, v: string) => void, get: (p: Project) => string): void {
    const input = this.input(id);
    input.addEventListener('input', () => {
      const v = input.value.trim();
      if (v) this.store.update((p) => set(p, v));
    });
    input.addEventListener('change', () => {
      if (!input.value.trim()) input.value = get(this.store.project);
    });
  }

  /**
   * Champ numérique : la vue se met à jour en direct tant que la valeur est valide ;
   * à la validation (perte de focus / Entrée), la valeur est ramenée dans les bornes.
   */
  private bindNumber(
    id: string,
    limits: { min: number; max: number },
    set: (room: Room, v: number) => void,
    get: (room: Room) => number,
  ): void {
    const input = this.input(id);
    const parse = () => Number(input.value.replace(',', '.'));
    input.addEventListener('input', () => {
      const v = parse();
      const valid = input.value !== '' && Number.isFinite(v) && v >= limits.min && v <= limits.max;
      input.classList.toggle('invalid', !valid);
      if (valid) this.store.update((p) => set(getActiveRoom(p), v));
    });
    input.addEventListener('change', () => {
      const v = parse();
      const fixed = Number.isFinite(v) && input.value !== '' ? clamp(Math.round(v * 10) / 10, limits.min, limits.max) : get(getActiveRoom(this.store.project));
      input.value = String(fixed);
      input.classList.remove('invalid');
      if (fixed !== get(getActiveRoom(this.store.project))) this.store.update((p) => set(getActiveRoom(p), fixed));
    });
  }
}
