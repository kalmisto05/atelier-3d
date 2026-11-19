import type { Project, Room } from '../model/types';
import { LIMITS, clamp, getActiveRoom } from '../model/factory';
import { computePlan } from '../model/geometry';
import type { ProjectStore } from '../model/store';
import { bindNumberFields, numberField } from './fields';
import { ObstaclesSection } from './obstacles';
import { OpeningsSection } from './openings';
import { OutletsSection } from './outlets';
import { WallsSection } from './walls';
import type { ListSection } from './list-section';
import type { Selection } from '../viewer/viewer';

export interface PanelActions {
  onRecenter(): void;
  onTopView(): void;
  onEyeView(): void;
  onExport(): void;
  onImport(): void;
  onNewProject(): void;
  onPlaceOutlet(): void;
  onPickPoint(): void;
}

const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export class Panel {
  readonly el: HTMLElement;
  readonly outlets: OutletsSection;
  private sections: ListSection[];
  private statusEl: HTMLElement;
  private summaryEl: HTMLElement;

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

      <section class="room-section" data-id="room">
        <h2>Pièce</h2>
        <label class="field" for="room-name">
          <span>Nom</span>
          <input id="room-name" type="text" maxlength="80" autocomplete="off" />
        </label>
        <div class="room-height"></div>
        <p class="summary"></p>
      </section>

      <div class="sections"></div>

      <section class="actions">
        <h2>Vue</h2>
        <div class="button-row">
          <button type="button" data-action="eye" class="wide">Vue à hauteur d'yeux (ZQSD)</button>
          <button type="button" data-action="recenter">Tourner autour</button>
          <button type="button" data-action="top">Vue de dessus</button>
        </div>
        <label class="field eye-field" for="eye-height">
          <span>Hauteur des yeux</span>
          <span class="input-unit">
            <input id="eye-height" type="number" inputmode="decimal" step="any" />
            <span class="unit">cm</span>
          </span>
        </label>
        <p class="hint">
          <span class="hint-mouse">Souris : clic gauche pour tourner, clic droit pour déplacer, molette pour zoomer.</span>
          <span class="hint-touch">Tactile : un doigt pour tourner, deux doigts pour zoomer et déplacer.</span>
        </p>
      </section>

      <section class="actions">
        <h2>Fichier</h2>
        <button type="button" data-action="export">Exporter (JSON)</button>
        <button type="button" data-action="import">Importer…</button>
        <button type="button" data-action="new" class="danger">Nouveau projet</button>
      </section>
    `;

    this.statusEl = this.el.querySelector('.status')!;
    this.summaryEl = this.el.querySelector('.summary')!;

    const handlers: Record<string, () => void> = {
      export: actions.onExport,
      import: actions.onImport,
      new: actions.onNewProject,
      recenter: actions.onRecenter,
      top: actions.onTopView,
      eye: actions.onEyeView,
    };
    this.el.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => handlers[btn.dataset.action!]());
    });

    this.bindText('project-name', (p, v) => (p.name = v), (p) => p.name);
    this.bindText('room-name', (p, v) => (getActiveRoom(p).name = v), (p) => getActiveRoom(p).name);

    const roomSection = this.el.querySelector<HTMLElement>('.room-section')!;
    bindNumberFields(roomSection, store, {
      get: (room) => room.height,
      set: (room, _id, _key, v) => (room.height = v),
      limits: () => LIMITS.roomHeight,
    });

    this.bindEyeHeight();

    const sections = this.el.querySelector('.sections')!;
    this.outlets = new OutletsSection(store, actions.onPlaceOutlet);
    this.sections = [
      new WallsSection(store, actions.onPickPoint),
      new OpeningsSection(store),
      this.outlets,
      new ObstaclesSection(store),
    ];
    for (const s of this.sections) sections.appendChild(s.root);

    store.subscribe((project, source) => {
      if (source === 'load') this.fill(project);
      this.updateSummary(getActiveRoom(project));
    });
    this.fill(store.project);
  }

  /**
   * Élément cliqué dans la vue 3D : ouvre sa section, met sa fiche en évidence.
   * Sous une fenêtre, le champ « Renfoncement dessous » est activé directement.
   */
  select(selection: Selection | null): void {
    for (const s of this.sections) {
      if (selection && s.kind === selection.kind) {
        if (selection.kind === 'wall' && selection.pointId) {
          // Pastille de sommet touchée : on active directement la hauteur de ce sommet.
          s.select(selection.id, 'h', selection.pointId);
          continue;
        }
        const focusKey = selection.kind === 'opening' && selection.zone === 'below' ? 'recess' : undefined;
        s.select(selection.id, focusKey);
      } else {
        s.select(null);
      }
    }
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
    this.input('eye-height').value = String(project.settings.eyeHeight);
    this.el.querySelector('.room-height')!.innerHTML = numberField('room', 'height', 'Hauteur sous plafond', room.height);
    this.updateSummary(room);
  }

  private updateSummary(room: Room): void {
    const area = Math.abs(computePlan(room).area) / 10000;
    const volume = (area * room.height) / 100;
    this.summaryEl.textContent = `Surface au sol : ${fmt.format(area)} m² · Volume : ${fmt.format(volume)} m³`;
  }

  private input(id: string): HTMLInputElement {
    return this.el.querySelector<HTMLInputElement>(`#${id}`)!;
  }

  /** Hauteur des yeux : réglage du projet (pas de la pièce), appliqué en direct. */
  private bindEyeHeight(): void {
    const input = this.input('eye-height');
    const { min, max } = LIMITS.eyeHeight;
    const parse = () => (input.value === '' ? NaN : Number(input.value.replace(',', '.')));
    input.addEventListener('input', () => {
      const v = parse();
      const valid = Number.isFinite(v) && v >= min && v <= max;
      input.classList.toggle('invalid', !valid);
      if (valid) this.store.update((p) => (p.settings.eyeHeight = v));
    });
    input.addEventListener('change', () => {
      const v = parse();
      const current = this.store.project.settings.eyeHeight;
      const fixed = Number.isFinite(v) ? clamp(Math.round(v * 10) / 10, min, max) : current;
      input.value = String(fixed);
      input.classList.remove('invalid');
      if (fixed !== current) this.store.update((p) => (p.settings.eyeHeight = fixed));
    });
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
}
