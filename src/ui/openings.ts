import type { Opening, OpeningKind, Room, WallSide } from '../model/types';
import {
  OPENING_LABELS,
  WALL_LABELS,
  WALL_SIDES,
  clamp,
  createOpening,
  findOpening,
  getActiveRoom,
  leastBusyWall,
  openingLimits,
  openingOverflows,
  wallLength,
} from '../model/factory';
import type { ProjectStore } from '../model/store';

type NumKey = 'offset' | 'width' | 'height' | 'sill';

const NUM_FIELDS: { key: NumKey; label: string; windowOnly?: boolean }[] = [
  { key: 'offset', label: 'Depuis la gauche' },
  { key: 'width', label: 'Largeur' },
  { key: 'height', label: 'Hauteur' },
  { key: 'sill', label: 'Allège', windowOnly: true },
];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Section du panneau listant les portes et fenêtres de la pièce active. */
export class OpeningsSection {
  private list: HTMLElement;

  constructor(
    private store: ProjectStore,
    root: HTMLElement,
  ) {
    root.innerHTML = `
      <h2>Ouvertures</h2>
      <p class="hint">Positions mesurées depuis le coin gauche du mur, vu de l'intérieur de la pièce.</p>
      <div class="opening-list"></div>
      <div class="button-row">
        <button type="button" data-add="porte">+ Porte</button>
        <button type="button" data-add="fenetre">+ Fenêtre</button>
      </div>
    `;
    this.list = root.querySelector('.opening-list')!;

    root.querySelectorAll<HTMLButtonElement>('button[data-add]').forEach((btn) =>
      btn.addEventListener('click', () => this.add(btn.dataset.add as OpeningKind)),
    );
    this.list.addEventListener('input', (e) => this.onInput(e));
    this.list.addEventListener('change', (e) => this.onChange(e));
    this.list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-remove]');
      if (btn) this.remove(btn.dataset.remove!);
    });

    store.subscribe((_p, source) => (source === 'load' ? this.render() : this.updateWarnings()));
    this.render();
  }

  private get room(): Room {
    return getActiveRoom(this.store.project);
  }

  private add(kind: OpeningKind): void {
    let id = '';
    this.store.update((p) => {
      const room = getActiveRoom(p);
      const side = leastBusyWall(room);
      const opening = createOpening(kind, room, side);
      id = opening.id;
      room.walls.find((w) => w.side === side)!.openings.push(opening);
    });
    this.render();
    const card = this.card(id);
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    card?.querySelector('select')?.focus({ preventScroll: true });
  }

  private remove(id: string): void {
    this.store.update((p) => {
      for (const w of getActiveRoom(p).walls) w.openings = w.openings.filter((o) => o.id !== id);
    });
    this.render();
  }

  private card(id: string): HTMLElement | null {
    return this.list.querySelector<HTMLElement>(`.opening-card[data-id="${CSS.escape(id)}"]`);
  }

  private target(e: Event): { id: string; el: HTMLInputElement | HTMLSelectElement } | null {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const id = el.closest<HTMLElement>('.opening-card')?.dataset.id;
    return id ? { id, el } : null;
  }

  /** Saisie en cours : mise à jour en direct si la valeur est dans les bornes. */
  private onInput(e: Event): void {
    const t = this.target(e);
    if (!t || !(t.el instanceof HTMLInputElement)) return;
    const key = t.el.dataset.key as NumKey;
    const found = findOpening(this.room, t.id);
    if (!found) return;
    const v = Number(t.el.value.replace(',', '.'));
    const lim = openingLimits(this.room, found.wall.side, found.opening)[key];
    const valid = t.el.value !== '' && Number.isFinite(v) && v >= lim.min && v <= lim.max;
    t.el.classList.toggle('invalid', !valid);
    if (valid) this.store.update((p) => (findOpening(getActiveRoom(p), t.id)!.opening[key] = v));
  }

  /** Validation (perte de focus, Entrée, choix dans la liste). */
  private onChange(e: Event): void {
    const t = this.target(e);
    if (!t) return;
    if (t.el instanceof HTMLSelectElement) return this.moveToWall(t.id, t.el.value as WallSide);

    const key = t.el.dataset.key as NumKey;
    const found = findOpening(this.room, t.id);
    if (!found) return;
    const lim = openingLimits(this.room, found.wall.side, found.opening)[key];
    const raw = Number(t.el.value.replace(',', '.'));
    const fixed =
      t.el.value !== '' && Number.isFinite(raw)
        ? Math.max(0, clamp(Math.round(raw * 10) / 10, lim.min, lim.max))
        : found.opening[key];
    t.el.value = String(fixed);
    t.el.classList.remove('invalid');
    if (fixed !== found.opening[key]) {
      this.store.update((p) => (findOpening(getActiveRoom(p), t.id)!.opening[key] = fixed));
    }
  }

  private moveToWall(id: string, side: WallSide): void {
    this.store.update((p) => {
      const room = getActiveRoom(p);
      const found = findOpening(room, id);
      if (!found || found.wall.side === side) return;
      const o = found.opening;
      found.wall.openings = found.wall.openings.filter((x) => x.id !== id);
      // On garde l'ouverture entière sur le nouveau mur.
      const len = wallLength(room, side);
      o.width = Math.min(o.width, len);
      o.offset = clamp(o.offset, 0, Math.max(0, len - o.width));
      room.walls.find((w) => w.side === side)!.openings.push(o);
    });
    this.render();
    this.card(id)?.querySelector('select')?.focus();
  }

  private updateWarnings(): void {
    const room = this.room;
    for (const wall of room.walls) {
      for (const o of wall.openings) {
        const warn = this.card(o.id)?.querySelector<HTMLElement>('.warning');
        if (warn) warn.hidden = !openingOverflows(room, wall.side, o);
      }
    }
  }

  /** Reconstruit la liste (changement de structure : ajout, suppression, changement de mur, chargement). */
  render(): void {
    const room = this.room;
    const counters: Record<OpeningKind, number> = { porte: 0, fenetre: 0 };
    const cards = room.walls.flatMap((wall) =>
      wall.openings.map((o) => this.cardHtml(o, wall.side, `${OPENING_LABELS[o.kind]} ${++counters[o.kind]}`)),
    );
    this.list.innerHTML = cards.length ? cards.join('') : '<p class="empty">Aucune porte ni fenêtre.</p>';
    this.updateWarnings();
  }

  private cardHtml(o: Opening, side: WallSide, title: string): string {
    const uid = `op-${o.id}`;
    const fields = NUM_FIELDS.filter((f) => !f.windowOnly || o.kind === 'fenetre')
      .map(
        (f) => `
        <label class="field" for="${uid}-${f.key}">
          <span>${f.label}</span>
          <span class="input-unit">
            <input id="${uid}-${f.key}" data-key="${f.key}" type="number" inputmode="decimal" step="1" value="${o[f.key]}" />
            <span class="unit">cm</span>
          </span>
        </label>`,
      )
      .join('');
    const options = WALL_SIDES.map(
      (s) => `<option value="${s}"${s === side ? ' selected' : ''}>${WALL_LABELS[s]}</option>`,
    ).join('');
    return `
      <div class="opening-card" data-id="${escapeHtml(o.id)}" data-kind="${o.kind}">
        <div class="opening-head">
          <strong>${title}</strong>
          <button type="button" class="small danger" data-remove="${escapeHtml(o.id)}" aria-label="Supprimer ${title}">Supprimer</button>
        </div>
        <label class="field" for="${uid}-wall">
          <span>Mur</span>
          <select id="${uid}-wall">${options}</select>
        </label>
        ${fields}
        <p class="warning" hidden>Dépasse du mur : ajustez la position ou les dimensions.</p>
      </div>`;
  }
}
