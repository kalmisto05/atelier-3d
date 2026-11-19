import type { Room } from '../model/types';
import { clamp, findOutlet, findWall, getActiveRoom, outletLimits, outletOverflows } from '../model/factory';
import type { ProjectStore } from '../model/store';
import { numberField } from './fields';
import { ListSection } from './list-section';

type Key = 'offset' | 'bottom' | 'width' | 'height';

/** Prises électriques de la pièce active. Elles se posent en touchant un mur dans la vue 3D. */
export class OutletsSection extends ListSection {
  private placeBtn: HTMLButtonElement;

  constructor(
    store: ProjectStore,
    private onPlaceRequest: () => void,
  ) {
    super(
      store,
      'Prises',
      'Touchez « Placer une prise », puis touchez un mur dans la vue 3D. Par défaut : 10 × 10 cm, bas à 18 cm du sol.',
      `<button type="button" data-place class="wide">+ Placer une prise</button>`,
    );
    this.placeBtn = this.root.querySelector<HTMLButtonElement>('button[data-place]')!;
    this.placeBtn.addEventListener('click', () => this.onPlaceRequest());

    this.list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-remove]');
      const id = btn?.closest<HTMLElement>('[data-id]')?.dataset.id;
      if (id) this.store.update((p) => {
        for (const w of getActiveRoom(p).walls) w.outlets = w.outlets.filter((o) => o.id !== id);
      });
    });
    this.list.addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement;
      const id = sel.closest<HTMLElement>('[data-id]')?.dataset.id;
      if (sel.matches('[data-wall-select]') && id) this.moveToWall(id, sel.value);
    });

    this.init({
      get: (room, id, key) => findOutlet(room, id)?.outlet[key as Key],
      set: (room, id, key, v) => {
        const f = findOutlet(room, id);
        if (f) f.outlet[key as Key] = v;
      },
      limits: (room, id, key) => {
        const f = findOutlet(room, id);
        return f ? outletLimits(room, f.wall, f.outlet)[key as Key] : undefined;
      },
    });
  }

  /** Reflète l'état du mode « placement » sur le bouton. */
  setPlacing(active: boolean): void {
    this.placeBtn.classList.toggle('active', active);
    this.placeBtn.textContent = active ? 'Touchez un mur… (annuler)' : '+ Placer une prise';
  }

  /** Après un placement : ouvre la section et montre la nouvelle prise. */
  revealOutlet(id: string): void {
    this.root.open = true;
    this.reveal(id);
  }

  private moveToWall(id: string, wallId: string): void {
    this.store.update((p) => {
      const room = getActiveRoom(p);
      const found = findOutlet(room, id);
      const target = findWall(room, wallId);
      if (!found || !target || found.wall === target) return;
      const o = found.outlet;
      found.wall.outlets = found.wall.outlets.filter((x) => x.id !== id);
      o.offset = clamp(o.offset, 0, Math.max(0, target.length - o.width));
      target.outlets.push(o);
    });
    this.card(id)?.querySelector('select')?.focus();
  }

  protected signature(room: Room): string {
    return room.walls.map((w) => w.id + ':' + w.outlets.map((o) => o.id).join('+')).join(',');
  }

  protected renderItems(room: Room): string {
    let n = 0;
    const cards = room.walls.flatMap((wall) =>
      wall.outlets.map((o) => {
        const title = `Prise ${++n}`;
        const uid = `out-${o.id}`;
        return `
        <div class="item-card" data-id="${o.id}" data-kind="prise">
          <div class="item-head">
            <strong>${title}</strong>
            <button type="button" class="small danger" data-remove aria-label="Supprimer ${title}">Supprimer</button>
          </div>
          ${this.wallSelect(uid, room, wall.id)}
          ${numberField(uid, 'offset', 'Depuis la gauche', o.offset)}
          ${numberField(uid, 'bottom', 'Bas depuis le sol', o.bottom)}
          ${numberField(uid, 'width', 'Largeur', o.width)}
          ${numberField(uid, 'height', 'Hauteur', o.height)}
          <p class="warning" hidden>Dépasse du mur : ajustez la position ou les dimensions.</p>
        </div>`;
      }),
    );
    return cards.length ? cards.join('') : '<p class="empty">Aucune prise.</p>';
  }

  protected update(room: Room): void {
    for (const wall of room.walls) {
      for (const o of wall.outlets) {
        const warn = this.card(o.id)?.querySelector<HTMLElement>('.warning');
        if (warn) warn.hidden = !outletOverflows(room, wall, o);
      }
    }
  }
}
