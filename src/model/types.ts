/**
 * Modèle de données du projet.
 *
 * Hiérarchie : Projet → Maison → Étages → Pièces → Murs (+ ouvertures, prises) / Obstacles / Meubles → Pièces de bois.
 *
 * Conventions :
 * - toutes les longueurs sont en centimètres, les angles en degrés ;
 * - plan d'une pièce vu de dessus : X vers la droite, Z vers le bas de l'écran, Y vers le haut ;
 * - une pièce est décrite par ses murs, dans l'ordre, en tournant dans le sens des aiguilles
 *   d'une montre (vu de dessus). Le mur 1 part de l'origine (0, 0) vers la droite (+X) ;
 * - sur un mur, les positions se mesurent depuis son début, c'est-à-dire depuis le coin
 *   de gauche quand on regarde le mur depuis l'intérieur de la pièce ;
 * - chaque entité possède un `id` stable (UUID) pour pouvoir être référencée.
 *
 * Toute modification incompatible du format doit incrémenter `SCHEMA_VERSION`
 * et ajouter une étape dans `migrate.ts`.
 */

export const SCHEMA_VERSION = 2;

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
  /** Hauteur sous plafond. */
  height: number;
  /** Position de la pièce dans l'étage (pour assembler plusieurs pièces plus tard). */
  position: Vec3;
  /** Contour intérieur, mur par mur, dans le sens des aiguilles d'une montre (au moins 3). */
  walls: Wall[];
  /** Volumes fixes qui encombrent la pièce : dessous d'escalier, poteau, coffrage… */
  obstacles: Obstacle[];
  furniture: Furniture[];
}

export interface Wall {
  id: Id;
  /** Nom libre (facultatif) ; à défaut, le mur est désigné par son numéro. */
  name: string;
  /** Longueur mesurée le long du parement intérieur. */
  length: number;
  /**
   * Angle intérieur du coin situé à la fin de ce mur (entre ce mur et le suivant) :
   * 90 = coin d'équerre, 135 = pan coupé à 45°, 270 = coin rentrant.
   */
  angle: number;
  /** Épaisseur du mur (profondeur des embrasures de fenêtre comprise). */
  thickness: number;
  openings: Opening[];
  outlets: Outlet[];
}

export type OpeningKind = 'porte' | 'fenetre';

export interface Opening {
  id: Id;
  kind: OpeningKind;
  /** Distance depuis le début du mur jusqu'au bord gauche de l'ouverture. */
  offset: number;
  width: number;
  height: number;
  /** Hauteur d'allège (0 pour une porte). */
  sill: number;
}

/** Prise électrique (ou interrupteur) posée sur le parement intérieur d'un mur. */
export interface Outlet {
  id: Id;
  /** Distance depuis le début du mur jusqu'au bord gauche de la prise. */
  offset: number;
  /** Hauteur du bas de la prise par rapport au sol. */
  bottom: number;
  width: number;
  height: number;
}

/** Bloc fixe, aligné sur les axes du plan. */
export interface Obstacle {
  id: Id;
  name: string;
  /** Coin du bloc le plus proche de l'origine, dans le plan de la pièce. */
  x: number;
  z: number;
  /** Dimensions selon X et Z. */
  width: number;
  depth: number;
  /** Hauteur du bas du bloc par rapport au sol. */
  bottom: number;
  height: number;
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
