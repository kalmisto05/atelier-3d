import { SCHEMA_VERSION, type Project } from './types';
import { DEFAULT_WALL_THICKNESS, LIMITS, MIN_WALLS, newId, rectangleWalls } from './factory';

export class ProjectFormatError extends Error {}

type Migration = (data: any) => any;

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function eachRoom(data: any, fn: (room: any) => void): void {
  for (const floor of data?.house?.floors ?? []) for (const room of floor?.rooms ?? []) if (isObject(room)) fn(room);
}

/**
 * Migrations successives : MIGRATIONS[n] transforme un projet de version n en version n + 1.
 */
const MIGRATIONS: Record<number, Migration> = {
  /**
   * v1 → v2 : la pièce rectangulaire (longueur × largeur, murs nord/est/sud/ouest) devient
   * une liste de murs. Le tour commence au mur nord et suit le sens horaire, ce qui
   * conserve exactement les positions des ouvertures existantes.
   */
  1: (data) => {
    eachRoom(data, (room) => {
      const L = isPositiveNumber(room.length) ? room.length : 400;
      const W = isPositiveNumber(room.width) ? room.width : 300;
      const old: any[] = Array.isArray(room.walls) ? room.walls : [];
      const names: Record<string, string> = { nord: 'Nord', est: 'Est', sud: 'Sud', ouest: 'Ouest' };
      room.walls = rectangleWalls(L, W).map((w, i) => {
        const side = ['nord', 'est', 'sud', 'ouest'][i];
        const prev = old.find((x) => isObject(x) && x.side === side) ?? {};
        return {
          ...w,
          id: prev.id ?? w.id,
          name: names[side],
          thickness: isPositiveNumber(prev.thickness) ? prev.thickness : DEFAULT_WALL_THICKNESS,
          openings: Array.isArray(prev.openings) ? prev.openings : [],
        };
      });
      delete room.length;
      delete room.width;
      room.obstacles = [];
    });
    return { ...data, schemaVersion: 2 };
  },
};

/** Garde les éléments valides d'une liste (les éléments illisibles sont écartés plutôt que de bloquer l'import). */
function keepValid<T>(list: unknown, valid: (o: any) => boolean): T[] {
  const items = (Array.isArray(list) ? list : []).filter((o) => isObject(o) && valid(o));
  for (const o of items) o.id ??= newId();
  return items as T[];
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
    floor.elevation = isFiniteNumber(floor.elevation) ? floor.elevation : 0;
    for (const room of floor.rooms) {
      if (!isObject(room)) throw new ProjectFormatError('Pièce invalide.');
      const label = `la pièce « ${room.name ?? '?'} »`;
      if (!isPositiveNumber(room.height)) throw new ProjectFormatError(`Hauteur invalide pour ${label}.`);
      if (!Array.isArray(room.walls) || room.walls.length < MIN_WALLS) {
        throw new ProjectFormatError(`Il faut au moins ${MIN_WALLS} murs pour ${label}.`);
      }
      room.id ??= newId();
      room.name ??= 'Pièce';
      room.position ??= { x: 0, y: 0, z: 0 };
      room.furniture = Array.isArray(room.furniture) ? room.furniture : [];
      room.walls.forEach((w: any, i: number) => {
        const ok =
          isObject(w) &&
          isPositiveNumber(w.length) &&
          isFiniteNumber(w.angle) &&
          w.angle >= LIMITS.wallAngle.min &&
          w.angle <= LIMITS.wallAngle.max;
        if (!ok) throw new ProjectFormatError(`Mur ${i + 1} invalide pour ${label}.`);
        w.id ??= newId();
        w.name = typeof w.name === 'string' ? w.name : '';
        w.thickness = isPositiveNumber(w.thickness) ? w.thickness : DEFAULT_WALL_THICKNESS;
        w.openings = keepValid(
          w.openings,
          (o) =>
            (o.kind === 'porte' || o.kind === 'fenetre') &&
            isPositiveNumber(o.width) &&
            isPositiveNumber(o.height) &&
            isFiniteNumber(o.offset) &&
            isFiniteNumber(o.sill),
        );
        w.outlets = keepValid(
          w.outlets,
          (o) => isPositiveNumber(o.width) && isPositiveNumber(o.height) && isFiniteNumber(o.offset) && isFiniteNumber(o.bottom),
        );
      });
      room.obstacles = keepValid(
        room.obstacles,
        (o) =>
          isFiniteNumber(o.x) &&
          isFiniteNumber(o.z) &&
          isPositiveNumber(o.width) &&
          isPositiveNumber(o.depth) &&
          isFiniteNumber(o.bottom) &&
          isPositiveNumber(o.height),
      );
      for (const o of room.obstacles) o.name = typeof o.name === 'string' ? o.name : 'Obstacle';
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
