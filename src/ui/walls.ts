import type { ProfilePoint, Room, Wall } from '../model/types';
import {
  LIMITS,
  MIN_WALLS,
  findProfilePoint,
  findWall,
  getActiveRoom,
  initProfile,
  newId,
  sortedProfile,
} from '../model/factory';
import { computePlan, topLine } from '../model/geometry';
import type { ProjectStore } from '../model/store';
import { escapeHtml, numberField } from './fields';
import { ListSection } from './list-section';

const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

type WallKey = 'length' | 'angle' | 'thickness';
type PointKey = 'u' | 'h';

/** Contour de la pièce, mur par mur, et haut de chaque mur (sommets). */
export class WallsSection extends ListSection {
  private status: HTMLElement;

  constructor(
    store: ProjectStore,
    /** Demande à poser un sommet en touchant un mur dans la vue 3D. */
    private onPickPoint: () => void,
  ) {
    super(
      store,
      'wall',
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
      const actions: Record<string, (id: string) => void> = {
        split: (wallId) => this.split(wallId),
        remove: (wallId) => this.remove(wallId),
        'edit-profile': (wallId) => this.editWall(wallId, initProfileOf),
        'reset-profile': (wallId) => this.editWall(wallId, (_r, w) => (w.profile = [])),
        'add-point': (wallId) => this.editWall(wallId, addMiddlePoint),
        'pick-point': () => this.onPickPoint(),
        'remove-point': (pointId) =>
          this.store.update((p) => {
            const f = findProfilePoint(getActiveRoom(p), pointId);
            if (f) f.wall.profile = f.wall.profile.filter((x) => x.id !== pointId);
          }),
      };
      actions[btn.dataset.action!]?.(id);
    });

    // Distance d'un sommet validée : on retrie les sommets (l'ordre affiché suit la distance).
    this.list.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.key !== 'u') return;
      const pointId = input.closest<HTMLElement>('[data-id]')?.dataset.id;
      if (!pointId) return;
      this.store.update((p) => {
        const f = findProfilePoint(getActiveRoom(p), pointId);
        if (f) f.wall.profile = sortedProfile(f.wall);
      });
    });

    this.init({
      get: (room, id, key) => {
        const w = findWall(room, id);
        if (w) return w[key as WallKey];
        return findProfilePoint(room, id)?.point[key as PointKey];
      },
      set: (room, id, key, v) => {
        const w = findWall(room, id);
        if (w) {
          w[key as WallKey] = v;
          return;
        }
        const f = findProfilePoint(room, id);
        if (f) f.point[key as PointKey] = v;
      },
      limits: (room, id, key) => {
        if (findWall(room, id)) {
          return ({ length: LIMITS.wallLength, angle: LIMITS.wallAngle, thickness: LIMITS.wallThickness } as const)[
            key as WallKey
          ];
        }
        const f = findProfilePoint(room, id);
        if (!f) return undefined;
        return key === 'u' ? { min: 0, max: f.wall.length } : { min: 0, max: room.height };
      },
    });
  }

  private editWall(id: string, fn: (room: Room, wall: Wall) => void): void {
    this.store.update((p) => {
      const room = getActiveRoom(p);
      const w = findWall(room, id);
      if (w) fn(room, w);
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
      // Le haut du mur est conservé : chaque moitié reçoit ses sommets, plus un sommet à la coupure.
      const profile = sortedProfile(w);
      const cutH = profile.length ? topLine(profile, room.height, half)(half) : room.height;
      const firstProfile: ProfilePoint[] = profile.length
        ? [...profile.filter((q) => q.u <= half), { id: newId(), u: half, h: cutH }]
        : [];
      const secondProfile: ProfilePoint[] = profile.length
        ? [{ id: newId(), u: 0, h: cutH }, ...profile.filter((q) => q.u > half).map((q) => ({ ...q, u: q.u - half }))]
        : [];
      const second: Wall = {
        id: newId(),
        name: '',
        length: Math.round((w.length - half) * 10) / 10,
        angle: w.angle,
        thickness: w.thickness,
        profile: secondProfile,
        openings: w.openings.filter((o) => o.offset >= half).map((o) => ({ ...o, offset: o.offset - half })),
        outlets: w.outlets.filter((o) => o.offset >= half).map((o) => ({ ...o, offset: o.offset - half })),
      };
      w.openings = w.openings.filter((o) => o.offset < half);
      w.outlets = w.outlets.filter((o) => o.offset < half);
      w.profile = firstProfile;
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

  protected count(room: Room): number {
    return room.walls.length;
  }

  protected signature(room: Room): string {
    return room.walls.map((w) => w.id + ':' + w.profile.map((q) => q.id).join('+')).join(',');
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
          ${this.profileHtml(w)}
        </div>`;
      })
      .join('');
  }

  private profileHtml(w: Wall): string {
    if (!w.profile.length) {
      return `
        <div class="profile">
          <span class="profile-title">Haut du mur : horizontal, au plafond</span>
          <button type="button" class="small" data-action="edit-profile">Modifier</button>
        </div>`;
    }
    const rows = w.profile
      .map(
        (q, k) => `
        <div class="profile-row" data-id="${q.id}">
          <span class="profile-index">${k + 1}</span>
          ${numberField(`pt-${q.id}`, 'u', '↔ Depuis la gauche', q.u)}
          ${numberField(`pt-${q.id}`, 'h', '↕ Hauteur du sol', q.h)}
          <button type="button" class="small danger" data-action="remove-point" aria-label="Supprimer le sommet ${k + 1}">✕</button>
        </div>`,
      )
      .join('');
    return `
      <div class="profile open">
        <span class="profile-title">Haut du mur — sommets numérotés comme dans la vue 3D.
          Touchez un champ : le sommet passe en orange, avec ses cotes.</span>
        ${rows}
        <div class="profile-actions">
          <button type="button" class="small" data-action="pick-point">+ Toucher le mur</button>
          <button type="button" class="small" data-action="add-point">+ Sommet</button>
          <button type="button" class="small" data-action="reset-profile">Remettre à plat</button>
        </div>
      </div>`;
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

function initProfileOf(room: Room, wall: Wall): void {
  initProfile(room, wall);
}

/** Ajoute un sommet au milieu du plus grand intervalle, sur la ligne actuelle du haut du mur. */
function addMiddlePoint(room: Room, wall: Wall): void {
  initProfile(room, wall);
  const pts = sortedProfile(wall);
  let best = { u: wall.length / 2, gap: -1 };
  for (let i = 0; i + 1 < pts.length; i++) {
    const gap = pts[i + 1].u - pts[i].u;
    if (gap > best.gap) best = { u: (pts[i].u + pts[i + 1].u) / 2, gap };
  }
  const u = Math.round(best.u * 10) / 10;
  const h = Math.round(topLine(pts, room.height, u)(u) * 10) / 10;
  wall.profile.push({ id: newId(), u, h });
  wall.profile = sortedProfile(wall);
}
