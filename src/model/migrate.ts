import { SCHEMA_VERSION, type Project } from './types';
import { WALL_SIDES, createWall, newId } from './factory';

export class ProjectFormatError extends Error {}

type Migration = (data: any) => any;

/**
 * Migrations successives : MIGRATIONS[n] transforme un projet de version n en version n + 1.
 * Exemple pour une future version 2 :
 *   1: (p) => ({ ...p, schemaVersion: 2, nouveauChamp: valeurParDefaut }),
 */
const MIGRATIONS: Record<number, Migration> = {};

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * Valide un objet inconnu (fichier importé, contenu IndexedDB), le migre vers
 * la version courante et renvoie un projet sûr à utiliser.
 */
export function parseProject(input: unknown): Project {
  if (!isObject(input)) throw new ProjectFormatError("Le fichier ne contient pas un projet valide.");

  let data: any = structuredClone(input);
  let version = data.schemaVersion;
  if (typeof version !== 'number') {
    throw new ProjectFormatError("Version du format absente : ce fichier ne vient pas d'Atelier 3D.");
  }
  if (version > SCHEMA_VERSION) {
    throw new ProjectFormatError(
      `Ce projet a été créé avec une version plus récente de l'application (format ${version}). Mettez l'application à jour.`,
    );
  }
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new ProjectFormatError(`Aucune migration depuis le format ${version}.`);
    data = step(data);
    version = data.schemaVersion;
  }

  if (!isObject(data.house) || !Array.isArray(data.house.floors) || data.house.floors.length === 0) {
    throw new ProjectFormatError('Le projet ne contient aucun étage.');
  }
  for (const floor of data.house.floors) {
    if (!isObject(floor) || !Array.isArray(floor.rooms) || floor.rooms.length === 0) {
      throw new ProjectFormatError('Un étage ne contient aucune pièce.');
    }
    floor.id ??= newId();
    floor.name ??= 'Étage';
    floor.elevation = typeof floor.elevation === 'number' ? floor.elevation : 0;
    for (const room of floor.rooms) {
      if (!isObject(room)) throw new ProjectFormatError('Pièce invalide.');
      for (const key of ['length', 'width', 'height'] as const) {
        if (!isPositiveNumber(room[key])) {
          throw new ProjectFormatError(`Dimension « ${key} » invalide pour la pièce « ${room.name ?? '?'} ».`);
        }
      }
      room.id ??= newId();
      room.name ??= 'Pièce';
      room.position ??= { x: 0, y: 0, z: 0 };
      room.furniture = Array.isArray(room.furniture) ? room.furniture : [];
      // Garantit les 4 murs, dans l'ordre attendu.
      const walls = Array.isArray(room.walls) ? room.walls : [];
      room.walls = WALL_SIDES.map((side) => {
        const w = walls.find((x: any) => isObject(x) && x.side === side);
        if (!w) return createWall(side);
        w.thickness = isPositiveNumber(w.thickness) ? w.thickness : createWall(side).thickness;
        w.openings = Array.isArray(w.openings) ? w.openings : [];
        return w;
      });
    }
  }

  data.id ??= newId();
  data.name = typeof data.name === 'string' && data.name.trim() ? data.name : 'Projet importé';
  data.house.id ??= newId();
  data.house.name ??= 'Maison';
  const now = new Date().toISOString();
  data.createdAt ??= now;
  data.updatedAt ??= now;

  const floors = data.house.floors;
  if (!floors.some((f: any) => f.id === data.activeFloorId)) data.activeFloorId = floors[0].id;
  const activeFloor = floors.find((f: any) => f.id === data.activeFloorId);
  if (!activeFloor.rooms.some((r: any) => r.id === data.activeRoomId)) {
    data.activeRoomId = activeFloor.rooms[0].id;
  }

  return data as Project;
}
