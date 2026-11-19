import type { Room, Wall } from './types';

/** Point du plan (vu de dessus) : X vers la droite, Z vers le bas de l'écran. */
export interface Pt {
  x: number;
  z: number;
}

export interface WallGeom {
  wall: Wall;
  index: number;
  /** Début et fin du parement intérieur (après répartition de l'écart de fermeture). */
  a: Pt;
  b: Pt;
  length: number;
  /** Direction unitaire du mur et normale unitaire vers l'extérieur. */
  dir: Pt;
  out: Pt;
  /** Coins extérieurs correspondants (assemblage en onglet avec les murs voisins). */
  oa: Pt;
  ob: Pt;
}

export interface RoomPlan {
  walls: WallGeom[];
  /** Coins intérieurs, dans l'ordre des murs. */
  polygon: Pt[];
  /** Décalage entre le point d'arrivée et le point de départ du tour, avant correction. */
  closureError: Pt;
  closureDistance: number;
  /** Somme des angles saisie moins la somme théorique (n − 2) × 180°. */
  angleError: number;
  area: number;
  bbox: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const add = (p: Pt, q: Pt): Pt => ({ x: p.x + q.x, z: p.z + q.z });
const sub = (p: Pt, q: Pt): Pt => ({ x: p.x - q.x, z: p.z - q.z });
const mul = (p: Pt, k: number): Pt => ({ x: p.x * k, z: p.z * k });
const cross = (p: Pt, q: Pt): number => p.x * q.z - p.z * q.x;
export const dot = (p: Pt, q: Pt): number => p.x * q.x + p.z * q.z;

/** Point du mur à la position `u` le long du mur et à la profondeur `d` vers l'extérieur. */
export function wallPoint(g: WallGeom, u: number, d: number): Pt {
  return add(g.a, add(mul(g.dir, u), mul(g.out, d)));
}

function lineIntersection(p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-9) return null;
  return add(p1, mul(d1, cross(sub(p2, p1), d2) / den));
}

/**
 * Calcule le plan de la pièce à partir de la liste des murs (longueur + angle du coin).
 *
 * Un relevé à la main ne se referme jamais parfaitement : l'écart entre le point d'arrivée
 * et le point de départ est réparti sur les coins au prorata de la distance parcourue
 * (méthode classique de compensation d'un cheminement).
 */
export function computePlan(room: Room): RoomPlan {
  const walls = room.walls;
  const n = walls.length;

  const raw: Pt[] = [{ x: 0, z: 0 }];
  const cum: number[] = [0];
  let heading = 0; // en radians ; 0 = vers +X, sens horaire à l'écran (Z vers le bas)
  for (let i = 0; i < n; i++) {
    const dir = { x: Math.cos(heading), z: Math.sin(heading) };
    raw.push(add(raw[i], mul(dir, walls[i].length)));
    cum.push(cum[i] + walls[i].length);
    heading += ((180 - walls[i].angle) * Math.PI) / 180;
  }
  const closureError = sub(raw[n], raw[0]);
  const total = cum[n] || 1;
  const polygon = raw.slice(0, n).map((p, i) => sub(p, mul(closureError, cum[i] / total)));

  const geoms: WallGeom[] = walls.map((wall, i) => {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const v = sub(b, a);
    const length = Math.hypot(v.x, v.z) || 1e-6;
    const dir = mul(v, 1 / length);
    // Parcours horaire à l'écran : l'extérieur est à gauche du sens de marche.
    const out = { x: dir.z, z: -dir.x };
    return { wall, index: i, a, b, length, dir, out, oa: a, ob: b };
  });

  // Coins extérieurs : intersection des parements extérieurs de deux murs consécutifs.
  for (let i = 0; i < n; i++) {
    const g = geoms[i];
    const h = geoms[(i + 1) % n];
    const tg = g.wall.thickness;
    const th = h.wall.thickness;
    let corner = lineIntersection(add(g.a, mul(g.out, tg)), g.dir, add(h.a, mul(h.out, th)), h.dir);
    // Murs alignés ou angle très aigu : on évite un onglet démesuré.
    if (!corner || Math.hypot(corner.x - g.b.x, corner.z - g.b.z) > 4 * Math.max(tg, th)) {
      corner = add(g.b, mul(g.out, tg));
    }
    g.ob = corner;
    h.oa = corner;
  }

  let area2 = 0;
  for (let i = 0; i < n; i++) area2 += cross(polygon[i], polygon[(i + 1) % n]);

  const xs = polygon.map((p) => p.x);
  const zs = polygon.map((p) => p.z);
  const angleSum = walls.reduce((s, w) => s + w.angle, 0);

  return {
    walls: geoms,
    polygon,
    closureError,
    closureDistance: Math.hypot(closureError.x, closureError.z),
    angleError: angleSum - (n - 2) * 180,
    area: area2 / 2,
    bbox: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) },
  };
}

/**
 * Découpe un polygone convexe par le demi-plan `f(p) >= 0` (Sutherland–Hodgman).
 * `f` doit être affine.
 */
export function clipConvex(poly: Pt[], f: (p: Pt) => number): Pt[] {
  const res: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = f(p);
    const fq = f(q);
    if (fp >= 0) res.push(p);
    if ((fp >= 0) !== (fq >= 0)) {
      const t = fp / (fp - fq);
      res.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
    }
  }
  return res;
}

/** Segments d'une droite horizontale ou verticale situés à l'intérieur d'un polygone (pour la grille du sol). */
export function insideSegments(polygon: Pt[], axis: 'x' | 'z', value: number): [number, number][] {
  const other = axis === 'x' ? 'z' : 'x';
  const hits: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    if ((p[axis] <= value) !== (q[axis] <= value)) {
      const t = (value - p[axis]) / (q[axis] - p[axis]);
      hits.push(p[other] + (q[other] - p[other]) * t);
    }
  }
  hits.sort((m, k) => m - k);
  const segs: [number, number][] = [];
  for (let i = 0; i + 1 < hits.length; i += 2) segs.push([hits[i], hits[i + 1]]);
  return segs;
}
