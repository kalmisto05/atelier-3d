import type { OpeningKind, Room } from '../model/types';
import {
  OPENING_LABELS,
  clamp,
  createOpening,
  findOpening,
  findWall,
  getActiveRoom,
  leastBusyWall,
  openingLimits,
  openingOverflows,
  recessLimits,
} from '../model/factory';
import type { ProjectStore } from '../model/store';
import { numberField } from './fields';
import { ListSection } from './list-section';

type Key = 'offset' | 'width' | 'height' | 'sill' | 'recess';

/** Portes et fenêtres de la pièce active. */
export class OpeningsSection extends ListSection {
  constructor(store: ProjectStore) {
    super(
      store,
      'opening',
      'Portes et fenêtres',
      `Position mesurée depuis le début du mur (son coin gauche, vu de l'intérieur de la pièce).
       <b>Renfoncement dessous</b> : de combien le mur est repoussé sous la fenêtre, du sol jusqu'à l'allège
       (cliquez sous une fenêtre dans la vue 3D pour y accéder directement).`,
      `<button type="button" data-add="porte">+ Porte</button>
       <button type="button" data-add="fenetre">+ Fenêtre</button>`,
    );
    this.root.querySelectorAll<HTMLButtonElement>('button[data-add]').forEach((btn) =>
      btn.addEventListener('click', () => this.add(btn.dataset.add as OpeningKind)),
    );
    this.list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-remove]');
      const id = btn?.closest<HTMLElement>('[data-id]')?.dataset.id;
      if (id) this.store.update((p) => {
        for (const w of getActiveRoom(p).walls) w.openings = w.openings.filter((o) => o.id !== id);
      });
    });
    this.list.addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement;
      const id = sel.closest<HTMLElement>('[data-id]')?.dataset.id;
      if (sel.matches('[data-wall-select]') && id) this.moveToWall(id, sel.value);
    });

    this.init({
      get: (room, id, key) => findOpening(room, id)?.opening[key as Key],
      set: (room, id, key, v) => {
        const f = findOpening(room, id);
        if (f) f.opening[key as Key] = v;
      },
      limits: (room, id, key) => {
        const f = findOpening(room, id);
        if (!f) return undefined;
        return key === 'recess' ? recessLimits(f.wall) : openingLimits(room, f.wall, f.opening)[key as Exclude<Key, 'recess'>];
      },
    });
  }

  private add(kind: OpeningKind): void {
    let id = '';
    this.store.update((p) => {
      const room = getActiveRoom(p);
      const wall = leastBusyWall(room);
      const opening = createOpening(kind, room, wall);
      id = opening.id;
      wall.openings.push(opening);
    });
    this.reveal(id);
  }

  private moveToWall(id: string, wallId: string): void {
    this.store.update((p) => {
      const room = getActiveRoom(p);
      const found = findOpening(room, id);
      const target = findWall(room, wallId);
      if (!found || !target || found.wall === target) return;
      const o = found.opening;
      found.wall.openings = found.wall.openings.filter((x) => x.id !== id);
      // On garde l'ouverture entière sur le nouveau mur.
      o.width = Math.min(o.width, target.length);
      o.offset = clamp(o.offset, 0, Math.max(0, target.length - o.width));
      target.openings.push(o);
    });
    this.card(id)?.querySelector('select')?.focus();
  }

  protected count(room: Room): number {
    return room.walls.reduce((n, w) => n + w.openings.length, 0);
  }

  protected signature(room: Room): string {
    return room.walls.map((w) => w.id + ':' + w.openings.map((o) => o.id).join('+')).join(',');
  }

  protected renderItems(room: Room): string {
    const counters: Record<OpeningKind, number> = { porte: 0, fenetre: 0 };
    const cards = room.walls.flatMap((wall) =>
      wall.openings.map((o) => {
        const title = `${OPENING_LABELS[o.kind]} ${++counters[o.kind]}`;
        const uid = `op-${o.id}`;
        return `
        <div class="item-card" data-id="${o.id}" data-kind="${o.kind}">
          <div class="item-head">
            <strong>${title}</strong>
            <button type="button" class="small danger" data-remove aria-label="Supprimer ${title}">Supprimer</button>
          </div>
          ${this.wallSelect(uid, room, wall.id)}
          ${numberField(uid, 'offset', 'Depuis la gauche', o.offset)}
          ${numberField(uid, 'width', 'Largeur', o.width)}
          ${numberField(uid, 'height', 'Hauteur', o.height)}
          ${o.kind === 'fenetre' ? numberField(uid, 'sill', 'Allège', o.sill) : ''}
          ${o.kind === 'fenetre' ? numberField(uid, 'recess', 'Renfoncement dessous', o.recess) : ''}
          <p class="warning" hidden>Dépasse du mur : ajustez la position ou les dimensions.</p>
        </div>`;
      }),
    );
    return cards.length ? cards.join('') : '<p class="empty">Aucune porte ni fenêtre.</p>';
  }

  protected update(room: Room): void {
    for (const wall of room.walls) {
      for (const o of wall.openings) {
        const warn = this.card(o.id)?.querySelector<HTMLElement>('.warning');
        if (warn) warn.hidden = !openingOverflows(room, wall, o);
      }
    }
  }
}
