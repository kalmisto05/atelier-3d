import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Room } from '../model/types';
import {
  clipConvex,
  computePlan,
  distanceToEdges,
  dot,
  insideSegments,
  pointInPolygon,
  wallPoint,
  type Pt,
  type RoomPlan,
  type WallGeom,
} from '../model/geometry';

/** Unité de la scène : 1 = 1 cm, comme le modèle. */

const COLORS = {
  background: 0x2a2420,
  floor: 0xd9c3a5,
  grid: 0x9c8366,
  wall: 0xf1ece4,
  wallEdge: 0x7a6a58,
  frame: 0xa8743f,
  glass: 0x9ec9e6,
  outlet: 0xfbfbf7,
  outletEdge: 0x555049,
  obstacle: 0xb7a48d,
  obstacleEdge: 0x6b5a48,
};

const FRAME_WIDTH = 5;
const FRAME_DEPTH = 6;
/** Saillie des prises par rapport au mur. */
const OUTLET_DEPTH = 1.5;

/** Visite à la première personne. */
const VISIT = {
  /** Marge au-dessus des yeux : un obstacle plus bas que yeux + marge bloque le passage. */
  headroom: 10,
  /** Distance minimale entre le visiteur et les murs ou obstacles. */
  radius: 25,
  walkSpeed: 150, // cm/s
  runSpeed: 320,
  turnSpeed: 1.8, // rad/s (flèches gauche/droite)
  lookSensitivity: 0.004, // rad par pixel
  fov: 70,
};

/**
 * Touches de déplacement, par position physique (`KeyboardEvent.code`) :
 * ZQSD sur un clavier AZERTY correspond à WASD sur un clavier QWERTY.
 */
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

export type ViewMode = 'orbit' | 'visit';

/** Matériau qui s'estompe quand son mur est entre la caméra et la pièce. */
interface Fadeable {
  material: THREE.Material;
  opacity: number;
  fadedOpacity: number;
}

interface WallView {
  geom: WallGeom;
  mesh: THREE.Mesh;
  fadeables: Fadeable[];
  /** Normale sortante et point du parement extérieur, dans le repère de la scène. */
  normal: THREE.Vector3;
  outerPoint: THREE.Vector3;
  faded: boolean;
}

/** Point touché sur le parement intérieur d'un mur. */
export interface WallHit {
  wallId: string;
  /** Position le long du mur depuis son début (cm). */
  u: number;
  /** Hauteur depuis le sol (cm). */
  y: number;
}

/**
 * Prisme droit : polygone convexe du plan extrudé entre les hauteurs y0 et y1.
 * Géométrie non indexée avec normales par face (rendu à facettes nettes).
 */
function prism(poly: Pt[], y0: number, y1: number): THREE.BufferGeometry | null {
  if (poly.length < 3 || y1 - y0 < 0.01) return null;
  const pos: number[] = [];
  const nor: number[] = [];
  const c = poly.reduce((s, p) => ({ x: s.x + p.x / poly.length, z: s.z + p.z / poly.length }), { x: 0, z: 0 });
  const tri = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3, expected: THREE.Vector3) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
    if (n.lengthSq() < 1e-10) return;
    if (n.dot(expected) < 0) [b, d] = [d, b];
    n.normalize();
    if (n.dot(expected) < 0) n.negate();
    for (const v of [a, b, d]) {
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
    }
  };
  const v = (p: Pt, y: number) => new THREE.Vector3(p.x, y, p.z);
  const up = new THREE.Vector3(0, 1, 0);
  const down = new THREE.Vector3(0, -1, 0);
  for (let i = 1; i + 1 < poly.length; i++) {
    tri(v(poly[0], y1), v(poly[i], y1), v(poly[i + 1], y1), up);
    tri(v(poly[0], y0), v(poly[i], y0), v(poly[i + 1], y0), down);
  }
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const mid = { x: (p.x + q.x) / 2 - c.x, z: (p.z + q.z) / 2 - c.z };
    const out = new THREE.Vector3(mid.x, 0, mid.z);
    tri(v(p, y0), v(q, y0), v(q, y1), out);
    tri(v(p, y0), v(q, y1), v(p, y1), out);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

function merge(list: (THREE.BufferGeometry | null)[]): THREE.BufferGeometry | null {
  const geoms = list.filter((g): g is THREE.BufferGeometry => g !== null);
  if (!geoms.length) return null;
  const merged = mergeGeometries(geoms);
  geoms.forEach((g) => g.dispose());
  return merged;
}

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  /** Groupe centré sur la pièce : l'origine de la scène est au centre du sol. */
  private roomGroup = new THREE.Group();
  private content = new THREE.Group();
  private walls: WallView[] = [];
  private plan: RoomPlan | null = null;
  private needsRender = true;
  private lastRoomKey = '';
  private tmp = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private tapListeners = new Set<(hit: WallHit | null) => void>();

  private room: Room | null = null;
  private mode: ViewMode = 'orbit';
  private modeListeners = new Set<(mode: ViewMode) => void>();
  private keys = new Set<string>();
  private joystick = { x: 0, y: 0 };
  private yaw = 0;
  private pitch = 0;
  private eyeHeight = 175;
  private lastTick = performance.now();

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(COLORS.background);
    this.scene.add(new THREE.HemisphereLight(0xfff6ea, 0x4a3a2c, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(300, 800, 500);
    this.scene.add(sun);
    this.scene.add(this.roomGroup);

    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 100000);
    this.camera.position.set(500, 500, 600);

    // OrbitControls gère nativement souris (gauche : rotation, droit : déplacement, molette : zoom)
    // et tactile (1 doigt : rotation, 2 doigts : zoom + déplacement).
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.01; // ne pas passer sous le sol
    this.controls.screenSpacePanning = true;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', () => this.requestRender());

    this.setupTap();
    this.setupVisitInput();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  requestRender(): void {
    this.needsRender = true;
  }

  /** Abonnement aux « touchers » (clic ou tape sans glisser) sur la vue 3D. */
  onTap(listener: (hit: WallHit | null) => void): () => void {
    this.tapListeners.add(listener);
    return () => this.tapListeners.delete(listener);
  }

  setCursor(cursor: string): void {
    this.renderer.domElement.style.cursor = cursor;
  }

  /** Reconstruit la géométrie de la pièce si elle a changé. Recadre la caméra sur demande. */
  setRoom(room: Room, options: { reframe?: boolean } = {}): void {
    this.room = room;
    const key = JSON.stringify(room);
    const changed = key !== this.lastRoomKey;
    this.lastRoomKey = key;
    if (!changed && !options.reframe) return;

    if (changed) {
      this.clearRoom();
      this.buildRoom(room);
      // En visite, on reste sur place mais à la bonne hauteur si le plafond a changé.
      if (this.mode === 'visit') this.camera.position.y = this.eyeY();
    }
    if (options.reframe) this.frameRoom(room);
    this.requestRender();
  }

  /** Recentre la caméra sur la pièce en vue 3/4. */
  frameRoom(room: Room): void {
    this.frame(room, new THREE.Vector3(0.6, 0.6, 0.75));
  }

  /** Vue de dessus, comme un plan. */
  frameTop(room: Room): void {
    this.frame(room, new THREE.Vector3(0, 1, 0.0001));
  }

  private frame(room: Room, direction: THREE.Vector3): void {
    this.leaveVisit();
    const plan = this.plan ?? computePlan(room);
    const sx = plan.bbox.maxX - plan.bbox.minX;
    const sz = plan.bbox.maxZ - plan.bbox.minZ;
    const size = Math.max(sx, sz, room.height);
    // Distance pour que la sphère englobant la pièce tienne dans le champ, en portrait comme en paysage.
    const radius = 0.5 * Math.hypot(sx, sz, room.height);
    const halfV = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect);
    const dist = (radius / Math.sin(Math.min(halfV, halfH))) * 1.02;
    this.controls.target.set(0, room.height * 0.35, 0);
    this.camera.position.copy(this.controls.target).addScaledVector(direction.clone().normalize(), dist);
    this.controls.minDistance = 30;
    this.controls.maxDistance = size * 6;
    this.controls.update();
    this.requestRender();
  }

  private clearRoom(): void {
    this.roomGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments || obj instanceof THREE.Sprite) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m: THREE.Material & { map?: THREE.Texture | null }) => {
          m.map?.dispose();
          m.dispose();
        });
      }
    });
    this.roomGroup.clear();
    this.walls = [];
  }

  private buildRoom(room: Room): void {
    const plan = computePlan(room);
    this.plan = plan;
    // Le plan a son origine au début du mur 1 ; on le décale pour centrer la vue.
    this.content = new THREE.Group();
    this.content.position.set(-(plan.bbox.minX + plan.bbox.maxX) / 2, 0, -(plan.bbox.minZ + plan.bbox.maxZ) / 2);
    this.roomGroup.add(this.content);

    // Sol : la forme est définie dans le plan XY puis couchée (Y du dessin → −Z de la scène).
    const shape = new THREE.Shape(plan.polygon.map((p) => new THREE.Vector2(p.x, -p.z)));
    const floor = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.content.add(floor, this.buildGrid(plan, 50));

    const labelSize = THREE.MathUtils.clamp(
      Math.max(plan.bbox.maxX - plan.bbox.minX, plan.bbox.maxZ - plan.bbox.minZ) * 0.05,
      14,
      50,
    );
    for (const g of plan.walls) {
      const view = this.buildWall(room, g);
      view.outerPoint.add(this.content.position);
      this.walls.push(view);

      const label = this.makeLabel(String(g.index + 1));
      label.scale.set(labelSize, labelSize, 1);
      const p = wallPoint(g, g.length / 2, -Math.min(labelSize * 1.2, g.length / 2));
      label.position.set(p.x, 1, p.z);
      this.content.add(label);
    }

    for (const o of room.obstacles) {
      const poly = [
        { x: o.x, z: o.z },
        { x: o.x + o.width, z: o.z },
        { x: o.x + o.width, z: o.z + o.depth },
        { x: o.x, z: o.z + o.depth },
      ];
      const top = Math.min(o.bottom + o.height, room.height);
      const geom = prism(poly, o.bottom, top);
      if (!geom) continue;
      const mesh = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({ color: COLORS.obstacle, roughness: 0.9, transparent: true, opacity: 0.85 }),
      );
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geom),
        new THREE.LineBasicMaterial({ color: COLORS.obstacleEdge }),
      );
      this.content.add(mesh, edges);
    }
  }

  private buildWall(room: Room, g: WallGeom): WallView {
    const wall = g.wall;
    const t = wall.thickness;
    const H = room.height;
    const len = g.length;
    const p = (u: number, d: number) => wallPoint(g, u, d);
    const uOf = (q: Pt) => dot({ x: q.x - g.a.x, z: q.z - g.a.z }, g.dir);
    /** Tranche du mur entre u0 et u1 (bornes facultatives), en tenant compte des onglets aux coins. */
    const quad = [g.a, g.b, g.ob, g.oa];
    const slice = (u0: number, u1: number) => {
      let poly = quad;
      if (Number.isFinite(u0)) poly = clipConvex(poly, (q) => uOf(q) - u0);
      if (Number.isFinite(u1)) poly = clipConvex(poly, (q) => u1 - uOf(q));
      return poly;
    };
    const rect = (u0: number, u1: number, d0: number, d1: number) => [p(u0, d0), p(u1, d0), p(u1, d1), p(u0, d1)];

    // Ouvertures rognées aux limites du mur (utile si la pièce a été modifiée après coup).
    const holes = wall.openings
      .map((o) => ({
        kind: o.kind,
        u0: Math.max(0, o.offset),
        u1: Math.min(len, o.offset + o.width),
        y0: Math.max(0, o.sill),
        y1: Math.min(H, o.sill + o.height),
      }))
      .filter((r) => r.u1 - r.u0 > 0.5 && r.y1 - r.y0 > 0.5);

    // Découpage en tranches verticales : dans chaque tranche, la maçonnerie est
    // la hauteur totale moins la réunion des ouvertures qui la traversent.
    const cuts = [-Infinity, ...[...new Set(holes.flatMap((h) => [h.u0, h.u1]))].sort((x, y) => x - y), Infinity];
    const solids: (THREE.BufferGeometry | null)[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const u0 = cuts[i];
      const u1 = cuts[i + 1];
      if (u1 - u0 < 0.01) continue;
      const poly = slice(u0, u1);
      const gaps = holes
        .filter((h) => h.u0 <= u0 + 1e-6 && h.u1 >= u1 - 1e-6)
        .map((h) => [h.y0, h.y1] as const)
        .sort((x, y) => x[0] - y[0]);
      let y = 0;
      for (const [g0, g1] of gaps) {
        if (g0 > y) solids.push(prism(poly, y, g0));
        y = Math.max(y, g1);
      }
      if (y < H) solids.push(prism(poly, y, H));
    }

    const fadeables: Fadeable[] = [];
    const fade = <M extends THREE.Material>(material: M, fadedOpacity: number): M => {
      material.transparent = true;
      fadeables.push({ material, opacity: material.opacity, fadedOpacity });
      return material;
    };

    const masonry = merge(solids) ?? new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(
      masonry,
      fade(new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.95 }), 0.12),
    );
    mesh.userData.wallId = wall.id;
    this.content.add(mesh);

    // Arêtes : contour du mur, contour de chaque ouverture sur les deux faces et dans l'épaisseur.
    const pts: number[] = [];
    const seg = (a: Pt, ya: number, b: Pt, yb: number) => pts.push(a.x, ya, a.z, b.x, yb, b.z);
    seg(g.a, 0, g.b, 0);
    seg(g.a, H, g.b, H);
    seg(g.oa, 0, g.ob, 0);
    seg(g.oa, H, g.ob, H);
    seg(g.b, H, g.ob, H);
    seg(g.oa, H, g.a, H);
    for (const c of [g.a, g.oa]) seg(c, 0, c, H);
    for (const h of holes) {
      for (const d of [0, t]) {
        seg(p(h.u0, d), h.y0, p(h.u1, d), h.y0);
        seg(p(h.u1, d), h.y0, p(h.u1, d), h.y1);
        seg(p(h.u1, d), h.y1, p(h.u0, d), h.y1);
        seg(p(h.u0, d), h.y1, p(h.u0, d), h.y0);
      }
      for (const [u, y] of [[h.u0, h.y0], [h.u1, h.y0], [h.u0, h.y1], [h.u1, h.y1]]) seg(p(u, 0), y, p(u, t), y);
    }
    const edgeGeom = new THREE.BufferGeometry();
    edgeGeom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.content.add(new THREE.LineSegments(edgeGeom, fade(new THREE.LineBasicMaterial({ color: COLORS.wallEdge }), 0.35)));

    // Menuiseries : cadre (sans traverse basse pour une porte) et vitre pour une fenêtre.
    // Dans un mur épais (embrasure), la fenêtre est posée près du parement extérieur.
    const fd = Math.min(FRAME_DEPTH, t);
    const d0 = t <= 2 * FRAME_DEPTH ? (t - fd) / 2 : t - fd - 4;
    const d1 = d0 + fd;
    const frames: (THREE.BufferGeometry | null)[] = [];
    const glasses: (THREE.BufferGeometry | null)[] = [];
    for (const h of holes) {
      const fw = Math.min(FRAME_WIDTH, (h.u1 - h.u0) / 4, (h.y1 - h.y0) / 4);
      frames.push(
        prism(rect(h.u0, h.u0 + fw, d0, d1), h.y0, h.y1),
        prism(rect(h.u1 - fw, h.u1, d0, d1), h.y0, h.y1),
        prism(rect(h.u0 + fw, h.u1 - fw, d0, d1), h.y1 - fw, h.y1),
      );
      if (h.kind === 'fenetre') {
        frames.push(prism(rect(h.u0 + fw, h.u1 - fw, d0, d1), h.y0, h.y0 + fw));
        const dm = (d0 + d1) / 2;
        glasses.push(prism(rect(h.u0 + fw, h.u1 - fw, dm - 0.5, dm + 0.5), h.y0 + fw, h.y1 - fw));
      }
    }
    const frameGeom = merge(frames);
    if (frameGeom) {
      this.content.add(
        new THREE.Mesh(frameGeom, fade(new THREE.MeshStandardMaterial({ color: COLORS.frame, roughness: 0.7 }), 0.15)),
      );
    }
    const glassGeom = merge(glasses);
    if (glassGeom) {
      const glassMat = fade(
        new THREE.MeshStandardMaterial({ color: COLORS.glass, roughness: 0.1, opacity: 0.35, depthWrite: false }),
        0.06,
      );
      this.content.add(new THREE.Mesh(glassGeom, glassMat));
    }

    // Prises : petits pavés en légère saillie sur le parement intérieur.
    const outletGeoms: (THREE.BufferGeometry | null)[] = [];
    const outletLines: number[] = [];
    for (const o of wall.outlets) {
      const u0 = Math.max(0, o.offset);
      const u1 = Math.min(len, o.offset + o.width);
      const y0 = Math.max(0, o.bottom);
      const y1 = Math.min(H, o.bottom + o.height);
      if (u1 - u0 < 0.5 || y1 - y0 < 0.5) continue;
      outletGeoms.push(prism(rect(u0, u1, -OUTLET_DEPTH, 0), y0, y1));
      const d = -OUTLET_DEPTH - 0.05;
      const corners: [number, number][] = [[u0, y0], [u1, y0], [u1, y1], [u0, y1]];
      corners.forEach(([u, y], k) => {
        const [un, yn] = corners[(k + 1) % 4];
        const a = p(u, d);
        const b = p(un, d);
        outletLines.push(a.x, y, a.z, b.x, yn, b.z);
      });
      // Deux trous de fiche, pour reconnaître une prise au premier coup d'œil.
      const cy = (y0 + y1) / 2;
      const r = Math.min(u1 - u0, y1 - y0) * 0.08;
      for (const cu of [(u0 * 2 + u1) / 3, (u0 + u1 * 2) / 3]) {
        const a = p(cu - r, d);
        const b = p(cu + r, d);
        outletLines.push(a.x, cy, a.z, b.x, cy, b.z);
      }
    }
    const outletGeom = merge(outletGeoms);
    if (outletGeom) {
      this.content.add(
        new THREE.Mesh(outletGeom, fade(new THREE.MeshStandardMaterial({ color: COLORS.outlet, roughness: 0.5 }), 0.2)),
      );
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(outletLines, 3));
      this.content.add(new THREE.LineSegments(lg, fade(new THREE.LineBasicMaterial({ color: COLORS.outletEdge }), 0.3)));
    }

    const mid = p(len / 2, t);
    return {
      geom: g,
      mesh,
      fadeables,
      normal: new THREE.Vector3(g.out.x, 0, g.out.z),
      outerPoint: new THREE.Vector3(mid.x, H / 2, mid.z),
      faded: false,
    };
  }

  private makeLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(60, 40, 25, 0.75)';
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '600 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f6ead9';
    ctx.fillText(text, 64, 68);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
    sprite.center.set(0.5, 0);
    return sprite;
  }

  /** Grille de 50 cm limitée à l'intérieur du sol. */
  private buildGrid(plan: RoomPlan, step: number): THREE.LineSegments {
    const pts: number[] = [];
    const y = 0.2; // légèrement au-dessus du sol pour éviter le scintillement
    const { minX, maxX, minZ, maxZ } = plan.bbox;
    for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
      for (const [z0, z1] of insideSegments(plan.polygon, 'x', x + 1e-4)) pts.push(x, y, z0, x, y, z1);
    }
    for (let z = Math.ceil(minZ / step) * step; z <= maxZ; z += step) {
      for (const [x0, x1] of insideSegments(plan.polygon, 'z', z + 1e-4)) pts.push(x0, y, z, x1, y, z);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(
      geom,
      new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.45 }),
    );
  }

  /** Distingue un toucher (clic bref, sans glisser) d'une rotation de caméra. */
  private setupTap(): void {
    const el = this.renderer.domElement;
    let start: { x: number; y: number; time: number; id: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      start = e.isPrimary ? { x: e.clientX, y: e.clientY, time: performance.now(), id: e.pointerId } : null;
    });
    el.addEventListener('pointerup', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      const quick = performance.now() - start.time < 600;
      start = null;
      if (moved > 8 || !quick || this.tapListeners.size === 0) return;
      const hit = this.pickWall(e.clientX, e.clientY);
      this.tapListeners.forEach((l) => l(hit));
    });
  }

  /** Mur visible (non estompé) sous le pointeur, avec la position touchée sur son parement intérieur. */
  pickWall(clientX: number, clientY: number): WallHit | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const candidates = this.walls.filter((w) => !w.faded);
    const hits = this.raycaster.intersectObjects(candidates.map((w) => w.mesh), false);
    for (const hit of hits) {
      const view = candidates.find((w) => w.mesh === hit.object);
      if (!view) continue;
      const local = this.content.worldToLocal(hit.point.clone());
      const g = view.geom;
      const rel = { x: local.x - g.a.x, z: local.z - g.a.z };
      // Seul le parement intérieur compte (pas le dessus ni les chants du mur).
      if (dot(rel, g.out) > 1) continue;
      return { wallId: g.wall.id, u: dot(rel, g.dir), y: local.y };
    }
    return null;
  }

  /** Estompe les murs situés entre la caméra et l'intérieur (vue « maison de poupée »). */
  private updateWallVisibility(): void {
    for (const w of this.walls) {
      // En visite, tous les murs restent pleins : on est dans la pièce.
      const faded =
        this.mode === 'orbit' && this.tmp.copy(this.camera.position).sub(w.outerPoint).dot(w.normal) > 0;
      if (faded === w.faded) continue;
      w.faded = faded;
      for (const f of w.fadeables) {
        f.material.opacity = faded ? f.fadedOpacity : f.opacity;
        // Un mur estompé ne doit pas masquer ce qu'il y a derrière lui.
        if (f.opacity === 1) f.material.depthWrite = !faded;
      }
    }
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  // ---------- Visite à la première personne ----------

  get viewMode(): ViewMode {
    return this.mode;
  }

  onModeChange(listener: (mode: ViewMode) => void): () => void {
    this.modeListeners.add(listener);
    return () => this.modeListeners.delete(listener);
  }

  /** Commande du joystick tactile : x vers la droite, y vers le bas, entre −1 et 1. */
  setJoystick(x: number, y: number): void {
    this.joystick = { x, y };
  }

  /** Hauteur des yeux (cm) utilisée par la vue à la première personne. */
  setEyeHeight(height: number): void {
    if (height === this.eyeHeight) return;
    this.eyeHeight = height;
    if (this.mode === 'visit') {
      this.camera.position.y = this.eyeY();
      this.requestRender();
    }
  }

  /** Hauteur réelle de la caméra : celle des yeux, sans traverser le plafond. */
  private eyeY(): number {
    return Math.min(this.eyeHeight, (this.room?.height ?? Infinity) - 5);
  }

  /**
   * Vue à hauteur d'yeux : debout au centre de la pièce, regard horizontal tourné vers le mur 1.
   * Si le centre n'est pas accessible (pièce en L, obstacle…), on prend l'endroit le plus dégagé.
   */
  eyeLevelView(): void {
    if (!this.plan || !this.room) return;
    const center = this.areaCentroid();
    const start = this.canStand(center) ? center : this.findOpenSpot();
    const c = this.content.position;
    this.camera.position.set(start.x + c.x, this.eyeY(), start.z + c.z);
    this.yaw = 0;
    this.pitch = 0;
    this.applyLook();
    this.controls.enabled = false;
    this.camera.fov = VISIT.fov;
    this.camera.updateProjectionMatrix();
    this.setMode('visit');
  }

  /** Revient à la vue orbitale cadrée sur la pièce. */
  exitVisit(): void {
    if (this.mode !== 'visit') return;
    if (this.room) this.frameRoom(this.room);
    else this.leaveVisit();
  }

  private leaveVisit(): void {
    if (this.mode !== 'visit') return;
    this.keys.clear();
    this.joystick = { x: 0, y: 0 };
    this.controls.enabled = true;
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
    this.setMode('orbit');
  }

  private setMode(mode: ViewMode): void {
    this.mode = mode;
    this.requestRender();
    this.modeListeners.forEach((l) => l(mode));
  }

  private applyLook(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.requestRender();
  }

  private setupVisitInput(): void {
    const isTyping = (e: KeyboardEvent) =>
      e.target instanceof HTMLElement && e.target.closest('input, select, textarea, [contenteditable]') !== null;
    window.addEventListener('keydown', (e) => {
      if (this.mode !== 'visit' || isTyping(e)) return;
      if (e.code === 'Escape') {
        this.exitVisit();
        return;
      }
      if (!MOVE_KEYS.has(e.code)) return;
      e.preventDefault(); // pas de défilement de la page avec les flèches
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // Fenêtre quittée : on évite les touches « coincées ».
    window.addEventListener('blur', () => this.keys.clear());

    // Regarder autour de soi en glissant (souris ou doigt).
    const el = this.renderer.domElement;
    let drag: { id: number; x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'visit' || drag) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      this.yaw -= (e.clientX - drag.x) * VISIT.lookSensitivity;
      this.pitch -= (e.clientY - drag.y) * VISIT.lookSensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
      drag.x = e.clientX;
      drag.y = e.clientY;
      this.applyLook();
    });
    const end = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /** Centre de gravité de la surface au sol. */
  private areaCentroid(): Pt {
    const poly = this.plan!.polygon;
    let a = 0;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const k = p.x * q.z - q.x * p.z;
      a += k;
      cx += (p.x + q.x) * k;
      cz += (p.z + q.z) * k;
    }
    if (Math.abs(a) < 1e-6) return { x: poly[0].x, z: poly[0].z };
    return { x: cx / (3 * a), z: cz / (3 * a) };
  }

  /** Une position (dans le plan) est-elle accessible au visiteur ? */
  private canStand(p: Pt): boolean {
    if (!this.plan || !this.room) return true;
    if (!pointInPolygon(p, this.plan.polygon) || distanceToEdges(p, this.plan.polygon) < VISIT.radius) return false;
    const r = VISIT.radius;
    return !this.room.obstacles.some(
      (o) =>
        o.bottom < this.eyeHeight + VISIT.headroom &&
        p.x > o.x - r &&
        p.x < o.x + o.width + r &&
        p.z > o.z - r &&
        p.z < o.z + o.depth + r,
    );
  }

  /** Point le plus éloigné des murs et obstacles (échantillonnage sur une grille). */
  private findOpenSpot(): Pt {
    const plan = this.plan!;
    const { minX, maxX, minZ, maxZ } = plan.bbox;
    let best: Pt = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    let bestScore = -Infinity;
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        const p = { x: minX + ((maxX - minX) * i) / steps, z: minZ + ((maxZ - minZ) * j) / steps };
        if (!this.canStand(p)) continue;
        const score = distanceToEdges(p, plan.polygon);
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }
    return best;
  }

  /** Avance le visiteur selon les touches et le joystick, en glissant le long des murs. */
  private updateVisit(dt: number): void {
    if (this.keys.has('ArrowLeft')) this.yaw += VISIT.turnSpeed * dt;
    if (this.keys.has('ArrowRight')) this.yaw -= VISIT.turnSpeed * dt;
    if (this.keys.has('ArrowLeft') || this.keys.has('ArrowRight')) this.applyLook();

    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    let fwd = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') - this.joystick.y;
    let side = k('KeyD') - k('KeyA') + this.joystick.x;
    const len = Math.hypot(fwd, side);
    if (len < 0.01) return;
    if (len > 1) {
      fwd /= len;
      side /= len;
    }
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const step = (run ? VISIT.runSpeed : VISIT.walkSpeed) * dt;
    // Avant = direction du regard projetée au sol.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const dx = (-sin * fwd + cos * side) * step;
    const dz = (-cos * fwd - sin * side) * step;

    const c = this.content.position;
    const pos = { x: this.camera.position.x - c.x, z: this.camera.position.z - c.z };
    // Si l'on est déjà coincé (pièce modifiée entre-temps), on laisse bouger librement.
    const free = !this.canStand(pos);
    const candidates = [
      { x: pos.x + dx, z: pos.z + dz },
      { x: pos.x + dx, z: pos.z },
      { x: pos.x, z: pos.z + dz },
    ];
    const next = candidates.find((p) => free || this.canStand(p));
    if (!next) return;
    this.camera.position.x = next.x + c.x;
    this.camera.position.z = next.z + c.z;
    this.requestRender();
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (this.mode === 'visit') this.updateVisit(dt);

    // update() renvoie true tant que l'amortissement fait bouger la caméra.
    const moving = this.mode === 'orbit' && this.controls.update();
    if (!moving && !this.needsRender) return;
    this.needsRender = false;
    this.updateWallVisibility();
    this.renderer.render(this.scene, this.camera);
  }
}
