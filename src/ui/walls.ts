import type { Room, Wall } from '../model/types';
import { LIMITS, MIN_WALLS, findWall, getActiveRoom, newId } from '../model/factory';
import { computePlan } from '../model/geometry';
import type { ProjectStore } from '../model/store';
import { escapeHtml, numberField } from './fields';
import { ListSection } from './list-section';

const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** Contour de la pièce, mur par mur. */
export class WallsSection extends ListSection {
  private status: HTMLElement;

  constructor(store: ProjectStore) {
    super(
      store,
      'Murs',
      `Faites le tour de la pièce dans le sens des aiguilles d'une montre, vu de dessus.
       <b>Angle du coin</b> : angle intérieur avec le mur suivant —
       90° coin normal, 135° pan coupé, 270° coin rentrant.
       L'épaisseur inclut la profondeur des embrasures de fenêtre.`,
      '',
    );
    this.status = document.createElement('div');
    this.status.className = 'closure';
    this.list.after(this.status);

    this.list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
      const id = btn?.closest<HTMLElement>('[data-id]')?.dataset.id;
      if (!btn || !id) return;
      if (btn.dataset.action === 'split') this.split(id);
      if (btn.dataset.action === 'remove') this.remove(id);
    });

    this.init({
      get: (room, id, key) => {
        const w = findWall(room, id);
        return w ? (w[key as 'length' | 'angle' | 'thickness'] as number) : undefined;
      },
      set: (room, id, key, v) => {
        const w = findWall(room, id);
        if (w) w[key as 'length' | 'angle' | 'thickness'] = v;
      },
      limits: (_room, _id, key) =>
        ({ length: LIMITS.wallLength, angle: LIMITS.wallAngle, thickness: LIMITS.wallThickness })[key],
    });
  }

  /** Coupe un mur en deux moitiés alignées (angle de 180°) : la forme ne change pas. */
  private split(id: string): void {
    this.store.update((p) => {
      const room = getActiveRoom(p);
      const i = room.walls.findIndex((w) => w.id === id);
      if (i < 0) return;
      const w = room.walls[i];
      const half = Math.round((w.length / 2) * 10) / 10;
      const second: Wall = {
        id: newId(),
        name: '',
        length: Math.round((w.length - half) * 10) / 10,
        angle: w.angle,
        thickness: w.thickness,
        openings: w.openings.filter((o) => o.offset >= half).map((o) => ({ ...o, offset: o.offset - half })),
        outlets: w.outlets.filter((o) => o.offset >= half).map((o) => ({ ...o, offset: o.offset - half })),
      };
      w.openings = w.openings.filter((o) => o.offset < half);
      w.outlets = w.outlets.filter((o) => o.offset < half);
      w.length = half;
      w.angle = 180;
      room.walls.splice(i + 1, 0, second);
    });
  }

  private remove(id: string): void {
    const room = this.room;
    const w = findWall(room, id);
    if (!w || room.walls.length <= MIN_WALLS) return;
    const extras = w.openings.length + w.outlets.length;
    const label = `le mur ${room.walls.indexOf(w) + 1}`;
    if (extras && !confirm(`Supprimer ${label} et ce qu'il contient (${extras} ouverture(s) ou prise(s)) ?`)) return;
    this.store.update((p) => {
      const r = getActiveRoom(p);
      r.walls = r.walls.filter((x) => x.id !== id);
    });
  }

  protected signature(room: Room): string {
    return room.walls.map((w) => w.id).join(',');
  }

  protected renderItems(room: Room): string {
    const canRemove = room.walls.length > MIN_WALLS;
    return room.walls
      .map((w, i) => {
        const uid = `wall-${w.id}`;
        const title = escapeHtml(w.name ? `Mur ${i + 1} · ${w.name}` : `Mur ${i + 1}`);
        return `
        <div class="item-card wall-card" data-id="${w.id}">
          <div class="item-head">
            <strong>${title}</strong>
            <span class="item-actions">
              <button type="button" class="small" data-action="split" title="Couper ce mur en deux (pour y créer un décrochement)">Diviser</button>
              ${canRemove ? `<button type="button" class="small danger" data-action="remove" aria-label="Supprimer ${title}">✕</button>` : ''}
            </span>
          </div>
          <div class="wall-grid">
            ${numberField(uid, 'length', 'Longueur', w.length)}
            ${numberField(uid, 'angle', 'Angle du coin', w.angle, '°')}
            ${numberField(uid, 'thickness', 'Épaisseur', w.thickness)}
          </div>
        </div>`;
      })
      .join('');
  }

  protected update(room: Room): void {
    const plan = computePlan(room);
    const lines: string[] = [];
    let kind = 'ok';
    if (plan.area <= 0) {
      kind = 'error';
      lines.push(
        "Le contour tourne dans le mauvais sens ou se croise : vérifiez les angles (90° = coin normal, 270° = coin rentrant).",
      );
    }
    if (Math.abs(plan.angleError) > 0.05) {
      kind = 'error';
      const expected = (room.walls.length - 2) * 180;
      lines.push(
        `Somme des angles : ${fmt.format(expected + plan.angleError)}° au lieu de ${expected}° pour ${room.walls.length} murs.`,
      );
    }
    if (plan.closureDistance < 0.5) {
      lines.push('✓ Le contour se referme.');
    } else {
      if (kind === 'ok') kind = 'warn';
      const e = plan.closureError;
      lines.push(
        `Écart de fermeture : <b>${fmt.format(plan.closureDistance)} cm</b>
         (${fmt.format(Math.abs(e.x))} cm en X, ${fmt.format(Math.abs(e.z))} cm en Z),
         réparti sur les murs pour fermer la pièce.`,
      );
    }
    this.status.dataset.kind = kind;
    this.status.innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
  }
}
