import {
  SCHEMA_VERSION,
  type Floor,
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

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
