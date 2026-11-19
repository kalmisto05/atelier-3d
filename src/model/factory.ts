import {
  SCHEMA_VERSION,
  type Floor,
  type Obstacle,
  type Opening,
  type OpeningKind,
  type Outlet,
  type Project,
  type Room,
  type Wall,
} from './types';

export const DEFAULT_WALL_THICKNESS = 10;
export const DEFAULT_EYE_HEIGHT = 175;

/** Bornes de saisie (cm et degrés). */
export const LIMITS = {
  eyeHeight: { min: 50, max: 250 },
  roomHeight: { min: 150, max: 1000 },
  wallLength: { min: 1, max: 5000 },
  wallAngle: { min: 1, max: 359 },
  wallThickness: { min: 1, max: 150 },
} as const;

export const MIN_WALLS = 3;

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Repli pour les contextes non sécurisés (http sur le réseau local).
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function createWall(length: number, angle = 90, thickness = DEFAULT_WALL_THICKNESS, name = ''): Wall {
  return { id: newId(), name, length, angle, thickness, openings: [], outlets: [] };
}

/** Quatre murs d'équerre : longueur selon X, largeur selon Z. */
export function rectangleWalls(length: number, width: number, thickness = DEFAULT_WALL_THICKNESS): Wall[] {
  return [length, width, length, width].map((l) => createWall(l, 90, thickness));
}

export function createRoom(name = 'Pièce 1'): Room {
  return {
    id: newId(),
    name,
    height: 250,
    position: { x: 0, y: 0, z: 0 },
    walls: rectangleWalls(400, 300),
    obstacles: [],
    furniture: [],
  };
}

export function createFloor(name = 'Rez-de-chaussée'): Floor {
  return { id: newId(), name, elevation: 0, rooms: [createRoom()] };
}

export function createProject(name = 'Mon projet'): Project {
  const floor = createFloor();
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
    house: { id: newId(), name: 'Maison', floors: [floor] },
    settings: { eyeHeight: DEFAULT_EYE_HEIGHT },
    activeFloorId: floor.id,
    activeRoomId: floor.rooms[0].id,
  };
}

/** Pièce active du projet (en garantissant qu'elle existe). */
export function getActiveRoom(project: Project): Room {
  const floor =
    project.house.floors.find((f) => f.id === project.activeFloorId) ?? project.house.floors[0];
  return floor.rooms.find((r) => r.id === project.activeRoomId) ?? floor.rooms[0];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------- Murs ----------

export function wallLabel(room: Room, wall: Wall): string {
  const n = room.walls.indexOf(wall) + 1;
  return wall.name ? `Mur ${n} · ${wall.name}` : `Mur ${n}`;
}

export function findWall(room: Room, id: string): Wall | undefined {
  return room.walls.find((w) => w.id === id);
}

/** Mur le moins chargé (parmi les plus longs), pour placer une nouvelle ouverture. */
export function leastBusyWall(room: Room): Wall {
  return [...room.walls].sort((a, b) => a.openings.length - b.openings.length || b.length - a.length)[0];
}

// ---------- Ouvertures ----------

export const OPENING_LABELS: Record<OpeningKind, string> = { porte: 'Porte', fenetre: 'Fenêtre' };

/** Dimensions standard (cm) : porte de 83 × 204, fenêtre de 100 × 115 avec allège de 95. */
export const OPENING_DEFAULTS: Record<OpeningKind, { width: number; height: number; sill: number }> = {
  porte: { width: 83, height: 204, sill: 0 },
  fenetre: { width: 100, height: 115, sill: 95 },
};

export const OPENING_MIN_SIZE = 20;

/** Bornes admissibles pour chaque grandeur d'une ouverture, compte tenu du mur et des autres valeurs. */
export function openingLimits(room: Room, wall: Wall, o: Opening) {
  return {
    offset: { min: 0, max: Math.max(0, wall.length - o.width) },
    width: { min: OPENING_MIN_SIZE, max: Math.max(OPENING_MIN_SIZE, wall.length - o.offset) },
    height: { min: OPENING_MIN_SIZE, max: Math.max(OPENING_MIN_SIZE, room.height - o.sill) },
    sill: { min: 0, max: Math.max(0, room.height - o.height) },
  };
}

/** Une ouverture dépasse-t-elle de son mur (après réduction de la pièce, par exemple) ? */
export function openingOverflows(room: Room, wall: Wall, o: Opening): boolean {
  return o.offset + o.width > wall.length + 0.01 || o.sill + o.height > room.height + 0.01;
}

/** Crée une ouverture centrée sur le mur, ajustée si le mur est trop petit. */
export function createOpening(kind: OpeningKind, room: Room, wall: Wall): Opening {
  const d = OPENING_DEFAULTS[kind];
  const width = Math.min(d.width, Math.max(OPENING_MIN_SIZE, wall.length - 20));
  const sill = kind === 'porte' ? 0 : Math.min(d.sill, Math.max(0, room.height - d.height - 20));
  const height = Math.min(d.height, room.height - sill - 10);
  return { id: newId(), kind, offset: Math.round((wall.length - width) / 2), width, height, sill };
}

export function findOpening(room: Room, id: string): { wall: Wall; opening: Opening } | null {
  for (const wall of room.walls) {
    const opening = wall.openings.find((o) => o.id === id);
    if (opening) return { wall, opening };
  }
  return null;
}

// ---------- Prises ----------

/** Prise standard : carré de 10 cm dont le bas est à 18 cm du sol. */
export const OUTLET_DEFAULTS = { width: 10, height: 10, bottom: 18 };

export function outletLimits(room: Room, wall: Wall, o: Outlet) {
  return {
    offset: { min: 0, max: Math.max(0, wall.length - o.width) },
    bottom: { min: 0, max: Math.max(0, room.height - o.height) },
    width: { min: 2, max: Math.min(200, wall.length) },
    height: { min: 2, max: Math.min(200, room.height - o.bottom) },
  };
}

export function outletOverflows(room: Room, wall: Wall, o: Outlet): boolean {
  return o.offset + o.width > wall.length + 0.01 || o.bottom + o.height > room.height + 0.01;
}

/** Crée une prise centrée sur la position `u` le long du mur. */
export function createOutlet(wall: Wall, u: number): Outlet {
  const { width, height, bottom } = OUTLET_DEFAULTS;
  const offset = clamp(Math.round(u - width / 2), 0, Math.max(0, wall.length - width));
  return { id: newId(), offset, bottom, width, height };
}

export function findOutlet(room: Room, id: string): { wall: Wall; outlet: Outlet } | null {
  for (const wall of room.walls) {
    const outlet = wall.outlets.find((o) => o.id === id);
    if (outlet) return { wall, outlet };
  }
  return null;
}

// ---------- Obstacles ----------

export function createObstacle(x: number, z: number): Obstacle {
  return { id: newId(), name: 'Obstacle', x, z, width: 50, depth: 50, bottom: 0, height: 100 };
}

export function obstacleLimits(room: Room, o: Obstacle) {
  return {
    x: { min: -5000, max: 5000 },
    z: { min: -5000, max: 5000 },
    width: { min: 1, max: 5000 },
    depth: { min: 1, max: 5000 },
    bottom: { min: 0, max: Math.max(0, room.height - 1) },
    height: { min: 1, max: Math.max(1, room.height - o.bottom) },
  };
}
