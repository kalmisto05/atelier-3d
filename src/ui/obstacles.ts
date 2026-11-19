import type { Obstacle, Room } from '../model/types';
import { createObstacle, getActiveRoom, obstacleLimits } from '../model/factory';
import { computePlan } from '../model/geometry';
import type { ProjectStore } from '../model/store';
import { escapeHtml, numberField } from './fields';
import { ListSection } from './list-section';

type Key = 'x' | 'z' | 'width' | 'depth' | 'bottom' | 'height';

/** Volumes fixes : dessous d'escalier, poteau, coffrage, cheminée… */
export class ObstaclesSection extends ListSection {
  constructor(store: ProjectStore) {
    super(
      store,
      'Obstacles',
      `Blocs fixes (dessous d'escalier, poteau, coffrage…). X et Z se mesurent depuis le début du mur 1 :
       X le long du mur 1, Z vers l'intérieur de la pièce.`,
      `<button type="button" data-add class="wide">+ Obstacle</button>`,
    );
    this.root.querySelector('button[data-add]')!.addEventListener('click', () => this.add());

    this.list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-remove]');
      const id = btn?.closest<HTMLElement>('[data-id]')?.dataset.id;
      if (id) this.store.update((p) => {
        const room = getActiveRoom(p);
        room.obstacles = room.obstacles.filter((o) => o.id !== id);
      });
    });
    // Nom : mise à jour en direct, sans reconstruire la liste.
    this.list.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      const id = input.closest<HTMLElement>('[data-id]')?.dataset.id;
      if (!input.matches('[data-name]') || !id) return;
      const name = input.value.trim();
      if (name) this.store.update((p) => {
        const o = getActiveRoom(p).obstacles.find((x) => x.id === id);
        if (o) o.name = name;
      });
    });

    const find = (room: Room, id: string): Obstacle | undefined => room.obstacles.find((o) => o.id === id);
    this.init({
      get: (room, id, key) => find(room, id)?.[key as Key],
      set: (room, id, key, v) => {
        const o = find(room, id);
        if (o) o[key as Key] = v;
      },
      limits: (room, id, key) => {
        const o = find(room, id);
        return o ? obstacleLimits(room, o)[key as Key] : undefined;
      },
    });
  }

  private add(): void {
    let id = '';
    this.store.update((p) => {
      const room = getActiveRoom(p);
      const { bbox } = computePlan(room);
      const o = createObstacle(Math.round((bbox.minX + bbox.maxX) / 2 - 25), Math.round((bbox.minZ + bbox.maxZ) / 2 - 25));
      id = o.id;
      room.obstacles.push(o);
    });
    this.reveal(id);
  }

  protected signature(room: Room): string {
    return room.obstacles.map((o) => o.id).join(',');
  }

  protected renderItems(room: Room): string {
    if (!room.obstacles.length) return '<p class="empty">Aucun obstacle.</p>';
    return room.obstacles
      .map((o) => {
        const uid = `obs-${o.id}`;
        return `
        <div class="item-card" data-id="${o.id}" data-kind="obstacle">
          <div class="item-head">
            <input class="name-input" data-name type="text" maxlength="60" value="${escapeHtml(o.name)}" aria-label="Nom de l'obstacle" />
            <button type="button" class="small danger" data-remove aria-label="Supprimer ${escapeHtml(o.name)}">Supprimer</button>
          </div>
          ${numberField(uid, 'x', 'X (le long du mur 1)', o.x)}
          ${numberField(uid, 'z', 'Z (vers l’intérieur)', o.z)}
          ${numberField(uid, 'width', 'Largeur (X)', o.width)}
          ${numberField(uid, 'depth', 'Profondeur (Z)', o.depth)}
          ${numberField(uid, 'bottom', 'Bas depuis le sol', o.bottom)}
          ${numberField(uid, 'height', 'Hauteur', o.height)}
        </div>`;
      })
      .join('');
  }
}
