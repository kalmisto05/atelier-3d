import {
  SCHEMA_VERSION,
  type Floor,
  type Opening,
  type OpeningKind,
  type Project,
  type Room,
  type Wall,
  type WallSide,
} from './types';

export const WALL_SIDES: WallSide[] = ['nord', 'est', 'sud', 'ouest'];

export const DEFAULT_WALL_THICKNESS = 10;

/** Bornes de saisie des dimensions d'une pièce (cm). */
export const ROOM_LIMITS = {
  length: { min: 50, max: 5000 },
  width: { min: 50, max: 5000 },
  height: { min: 150, max: 1000 },
  thickness: { min: 2, max: 100 },
} as const;

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Repli pour les contextes non sécurisés (http sur le réseau local).
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function createWall(side: WallSide, thickness = DEFAULT_WALL_THICKNESS): Wall {
  return { id: newId(), side, thickness, openings: [] };
}

export function createRoom(name = 'Pièce 1'): Room {
  return {
    id: newId(),
    name,
    length: 400,
    width: 300,
    height: 250,
    position: { x: 0, y: 0, z: 0 },
    walls: WALL_SIDES.map((side) => createWall(side)),
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

export const WALL_LABELS: Record<WallSide, string> = {
  nord: 'Nord',
  est: 'Est',
  sud: 'Sud',
  ouest: 'Ouest',
};

/** Longueur intérieure d'un mur (cm). */
export function wallLength(room: Room, side: WallSide): number {
  return side === 'nord' || side === 'sud' ? room.length : room.width;
}

export const OPENING_LABELS: Record<OpeningKind, string> = { porte: 'Porte', fenetre: 'Fenêtre' };

/** Dimensions standard (cm) : porte de 83 × 204, fenêtre de 100 × 115 avec allège de 95. */
export const OPENING_DEFAULTS: Record<OpeningKind, { width: number; height: number; sill: number }> = {
  porte: { width: 83, height: 204, sill: 0 },
  fenetre: { width: 100, height: 115, sill: 95 },
};

export const OPENING_MIN_SIZE = 20;

/** Bornes admissibles pour chaque grandeur d'une ouverture, compte tenu du mur et des autres valeurs. */
export function openingLimits(room: Room, side: WallSide, o: Opening) {
  const len = wallLength(room, side);
  const H = room.height;
  return {
    offset: { min: 0, max: Math.max(0, len - o.width) },
    width: { min: OPENING_MIN_SIZE, max: len - o.offset },
    height: { min: OPENING_MIN_SIZE, max: H - o.sill },
    sill: { min: 0, max: Math.max(0, H - o.height) },
  };
}

/** Une ouverture dépasse-t-elle de son mur (après réduction de la pièce, par exemple) ? */
export function openingOverflows(room: Room, side: WallSide, o: Opening): boolean {
  return o.offset + o.width > wallLength(room, side) + 0.01 || o.sill + o.height > room.height + 0.01;
}

/** Crée une ouverture centrée sur le mur, ajustée si le mur est trop petit. */
export function createOpening(kind: OpeningKind, room: Room, side: WallSide): Opening {
  const d = OPENING_DEFAULTS[kind];
  const len = wallLength(room, side);
  const width = Math.min(d.width, Math.max(OPENING_MIN_SIZE, len - 20));
  const sill = kind === 'porte' ? 0 : Math.min(d.sill, Math.max(0, room.height - d.height - 20));
  const height = Math.min(d.height, room.height - sill - 10);
  return { id: newId(), kind, offset: Math.round((len - width) / 2), width, height, sill };
}

/** Mur le moins chargé, pour placer une nouvelle ouverture sans chevauchement. */
export function leastBusyWall(room: Room): WallSide {
  return [...room.walls].sort((a, b) => a.openings.length - b.openings.length)[0].side;
}

export function findOpening(room: Room, id: string): { wall: Wall; opening: Opening } | null {
  for (const wall of room.walls) {
    const opening = wall.openings.find((o) => o.id === id);
    if (opening) return { wall, opening };
  }
  return null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
