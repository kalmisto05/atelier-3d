/**
 * Modèle de données du projet.
 *
 * Hiérarchie : Projet → Maison → Étages → Pièces → Murs (+ ouvertures) / Meubles → Pièces de bois.
 *
 * Conventions :
 * - toutes les longueurs sont en centimètres ;
 * - les angles sont en degrés ;
 * - repère d'une pièce : origine au coin intérieur (0, 0, 0) au niveau du sol,
 *   X le long de la longueur, Z le long de la largeur, Y vers le haut ;
 * - chaque entité possède un `id` stable (UUID) pour pouvoir être référencée.
 *
 * Toute modification incompatible du format doit incrémenter `SCHEMA_VERSION`
 * et ajouter une étape dans `migrate.ts`.
 */

export const SCHEMA_VERSION = 1;

export type Id = string;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Project {
  schemaVersion: number;
  id: Id;
  name: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  house: House;
  /** Sélection courante dans l'interface (persistée pour retrouver son contexte). */
  activeFloorId: Id;
  activeRoomId: Id;
}

export interface House {
  id: Id;
  name: string;
  floors: Floor[];
}

export interface Floor {
  id: Id;
  name: string;
  /** Altitude du sol de l'étage par rapport au rez-de-chaussée. */
  elevation: number;
  rooms: Room[];
}

export interface Room {
  id: Id;
  name: string;
  /** Dimensions intérieures. */
  length: number; // selon X
  width: number; // selon Z
  height: number; // selon Y
  /** Position de la pièce dans l'étage (pour assembler plusieurs pièces plus tard). */
  position: Vec3;
  /** Toujours 4 murs pour une pièce rectangulaire, dans l'ordre nord, est, sud, ouest. */
  walls: Wall[];
  furniture: Furniture[];
}

/** Côté de la pièce rectangulaire porté par un mur. */
export type WallSide = 'nord' | 'est' | 'sud' | 'ouest';

export interface Wall {
  id: Id;
  side: WallSide;
  thickness: number;
  openings: Opening[];
}

export type OpeningKind = 'porte' | 'fenetre';

export interface Opening {
  id: Id;
  kind: OpeningKind;
  /** Distance depuis le début du mur (vu de l'intérieur, de gauche à droite). */
  offset: number;
  width: number;
  height: number;
  /** Hauteur d'allège (0 pour une porte). */
  sill: number;
}

export interface Furniture {
  id: Id;
  name: string;
  /** Position dans le repère de la pièce. */
  position: Vec3;
  /** Rotation autour de l'axe vertical. */
  rotationY: number;
  parts: WoodPart[];
}

export interface WoodPart {
  id: Id;
  name: string;
  /** Essence de bois (chêne, noyer, hêtre…). */
  species: string;
  /** Dimensions brutes de la pièce de bois. */
  length: number;
  width: number;
  thickness: number;
  /** Sens du fil, le long de la longueur par défaut. */
  grain: 'longueur' | 'largeur';
  /** Position et orientation dans le repère du meuble. */
  position: Vec3;
  rotation: Vec3;
}
