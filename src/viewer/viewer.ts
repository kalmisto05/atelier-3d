import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { OpeningKind, Room, Wall, WallSide } from '../model/types';
import { WALL_LABELS, wallLength } from '../model/factory';

/** Unité de la scène : 1 = 1 cm, comme le modèle. */

const COLORS = {
  background: 0x2a2420,
  floor: 0xd9c3a5,
  grid: 0x9c8366,
  wall: 0xf1ece4,
  wallEdge: 0x7a6a58,
  frame: 0xa8743f,
  glass: 0x9ec9e6,
};

const FRAME_WIDTH = 5;
const FRAME_DEPTH = 6;

/** Matériau qui s'estompe quand son mur est entre la caméra et la pièce. */
interface Fadeable {
  material: THREE.Material;
  opacity: number;
  fadedOpacity: number;
}

interface WallView {
  side: WallSide;
  fadeables: Fadeable[];
  /** Normale sortante et point du parement extérieur, dans le repère de la scène. */
  normal: THREE.Vector3;
  outerPoint: THREE.Vector3;
  faded: boolean;
}

/** Rectangle dans le plan du mur : u le long du mur (vu de l'intérieur, de gauche à droite), y vers le haut. */
interface Rect {
  u0: number;
  u1: number;
  y0: number;
  y1: number;
}

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  /** Groupe centré sur la pièce : l'origine de la scène est au centre du sol. */
  private roomGroup = new THREE.Group();
  private walls: WallView[] = [];
  private needsRender = true;
  private lastRoomKey = '';
  private tmp = new THREE.Vector3();

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

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  requestRender(): void {
    this.needsRender = true;
  }

  /** Reconstruit la géométrie de la pièce si elle a changé. Recadre la caméra sur demande. */
  setRoom(room: Room, options: { reframe?: boolean } = {}): void {
    const key = JSON.stringify([room.id, room.length, room.width, room.height, room.walls]);
    const changed = key !== this.lastRoomKey;
    this.lastRoomKey = key;
    if (!changed && !options.reframe) return;

    if (changed) {
      this.clearRoom();
      this.buildRoom(room);
    }
    if (options.reframe) this.frameRoom(room);
    this.requestRender();
  }

  /** Recentre la caméra sur la pièce en vue 3/4. */
  frameRoom(room: Room): void {
    const size = Math.max(room.length, room.width, room.height);
    // Distance pour que la sphère englobant la pièce tienne dans le champ, en portrait comme en paysage.
    const radius = 0.5 * Math.hypot(room.length, room.width, room.height);
    const halfV = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect);
    const dist = (radius / Math.sin(Math.min(halfV, halfH))) * 1.02;
    const dir = new THREE.Vector3(0.6, 0.6, 0.75).normalize();
    this.controls.target.set(0, room.height * 0.35, 0);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
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
    const { length: L, width: W } = room;
    // Le repère de la pièce a son origine au coin intérieur ; on le décale pour centrer la vue.
    const content = new THREE.Group();
    content.position.set(-L / 2, 0, -W / 2);
    this.roomGroup.add(content);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(L, W),
      new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(L / 2, 0, W / 2);
    content.add(floor);
    content.add(this.buildGrid(L, W, 50));

    for (const wall of room.walls) {
      const view = this.buildWall(room, wall, content);
      view.outerPoint.add(content.position);
      this.walls.push(view);
    }
  }

  /**
   * Passe des coordonnées du mur (u le long du mur, y vers le haut, d profondeur depuis
   * le parement intérieur vers l'extérieur) au repère de la pièce.
   */
  private wallToRoom(room: Room, side: WallSide, u: number, y: number, d: number): THREE.Vector3 {
    const { length: L, width: W } = room;
    switch (side) {
      case 'nord':
        return new THREE.Vector3(u, y, -d);
      case 'sud':
        return new THREE.Vector3(L - u, y, W + d);
      case 'est':
        return new THREE.Vector3(L + d, y, u);
      case 'ouest':
        return new THREE.Vector3(-d, y, W - u);
    }
  }

  /** Pavé aligné sur le mur, couvrant le rectangle `r` sur la profondeur [d0, d1]. */
  private wallBox(room: Room, side: WallSide, r: Rect, d0: number, d1: number): THREE.BoxGeometry {
    const du = r.u1 - r.u0;
    const dy = r.y1 - r.y0;
    const dd = d1 - d0;
    const alongX = side === 'nord' || side === 'sud';
    const geom = alongX ? new THREE.BoxGeometry(du, dy, dd) : new THREE.BoxGeometry(dd, dy, du);
    const c = this.wallToRoom(room, side, (r.u0 + r.u1) / 2, (r.y0 + r.y1) / 2, (d0 + d1) / 2);
    geom.translate(c.x, c.y, c.z);
    return geom;
  }

  private buildWall(room: Room, wall: Wall, parent: THREE.Group): WallView {
    const side = wall.side;
    const t = wall.thickness;
    const H = room.height;
    const len = wallLength(room, side);
    const thick = Object.fromEntries(room.walls.map((w) => [w.side, w.thickness])) as Record<WallSide, number>;

    // Les murs nord et sud recouvrent les angles ; est et ouest s'arrêtent à leurs parements.
    const [uMin, uMax] =
      side === 'nord' ? [-thick.ouest, len + thick.est] : side === 'sud' ? [-thick.est, len + thick.ouest] : [0, len];

    // Ouvertures rognées aux limites du mur (utile si la pièce a été réduite après coup).
    const holes: (Rect & { kind: OpeningKind })[] = wall.openings
      .map((o) => ({
        kind: o.kind,
        u0: Math.max(0, o.offset),
        u1: Math.min(len, o.offset + o.width),
        y0: Math.max(0, o.sill),
        y1: Math.min(H, o.sill + o.height),
      }))
      .filter((r) => r.u1 - r.u0 > 0.5 && r.y1 - r.y0 > 0.5);

    // Découpage en colonnes verticales : dans chaque colonne, la maçonnerie est
    // la hauteur totale moins la réunion des ouvertures qui la traversent.
    const cuts = [...new Set([uMin, uMax, ...holes.flatMap((h) => [h.u0, h.u1])])].sort((a, b) => a - b);
    const solids: THREE.BoxGeometry[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const u0 = cuts[i];
      const u1 = cuts[i + 1];
      if (u1 - u0 < 0.01) continue;
      const gaps = holes
        .filter((h) => h.u0 <= u0 + 1e-6 && h.u1 >= u1 - 1e-6)
        .map((h) => [h.y0, h.y1] as const)
        .sort((a, b) => a[0] - b[0]);
      let y = 0;
      for (const [g0, g1] of gaps) {
        if (g0 > y) solids.push(this.wallBox(room, side, { u0, u1, y0: y, y1: g0 }, 0, t));
        y = Math.max(y, g1);
      }
      if (y < H) solids.push(this.wallBox(room, side, { u0, u1, y0: y, y1: H }, 0, t));
    }

    const fadeables: Fadeable[] = [];
    const fade = <M extends THREE.Material>(material: M, fadedOpacity: number): M => {
      material.transparent = true;
      fadeables.push({ material, opacity: material.opacity, fadedOpacity });
      return material;
    };

    const wallMat = fade(new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.95 }), 0.12);
    const masonry = mergeGeometries(solids);
    solids.forEach((g) => g.dispose());
    parent.add(new THREE.Mesh(masonry, wallMat));

    // Arêtes : contour du mur + contour de chaque ouverture sur les deux faces et dans l'épaisseur.
    const pts: number[] = [];
    const seg = (a: THREE.Vector3, b: THREE.Vector3) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const p = (u: number, y: number, d: number) => this.wallToRoom(room, side, u, y, d);
    const rectOutline = (r: Rect, d: number) => {
      seg(p(r.u0, r.y0, d), p(r.u1, r.y0, d));
      seg(p(r.u1, r.y0, d), p(r.u1, r.y1, d));
      seg(p(r.u1, r.y1, d), p(r.u0, r.y1, d));
      seg(p(r.u0, r.y1, d), p(r.u0, r.y0, d));
    };
    rectOutline({ u0: uMin, u1: uMax, y0: 0, y1: H }, 0);
    rectOutline({ u0: uMin, u1: uMax, y0: 0, y1: H }, t);
    for (const [u, y] of [[uMin, 0], [uMax, 0], [uMin, H], [uMax, H]]) seg(p(u, y, 0), p(u, y, t));
    for (const h of holes) {
      rectOutline(h, 0);
      rectOutline(h, t);
      for (const [u, y] of [[h.u0, h.y0], [h.u1, h.y0], [h.u0, h.y1], [h.u1, h.y1]]) seg(p(u, y, 0), p(u, y, t));
    }
    const edgeGeom = new THREE.BufferGeometry();
    edgeGeom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    parent.add(new THREE.LineSegments(edgeGeom, fade(new THREE.LineBasicMaterial({ color: COLORS.wallEdge }), 0.35)));

    // Menuiseries : cadre (sans traverse basse pour une porte) et vitre pour une fenêtre.
    const frames: THREE.BoxGeometry[] = [];
    const glasses: THREE.BoxGeometry[] = [];
    const fd = Math.min(FRAME_DEPTH, t);
    const [d0, d1] = [(t - fd) / 2, (t + fd) / 2];
    for (const h of holes) {
      const fw = Math.min(FRAME_WIDTH, (h.u1 - h.u0) / 4, (h.y1 - h.y0) / 4);
      frames.push(
        this.wallBox(room, side, { u0: h.u0, u1: h.u0 + fw, y0: h.y0, y1: h.y1 }, d0, d1),
        this.wallBox(room, side, { u0: h.u1 - fw, u1: h.u1, y0: h.y0, y1: h.y1 }, d0, d1),
        this.wallBox(room, side, { u0: h.u0 + fw, u1: h.u1 - fw, y0: h.y1 - fw, y1: h.y1 }, d0, d1),
      );
      if (h.kind === 'fenetre') {
        frames.push(this.wallBox(room, side, { u0: h.u0 + fw, u1: h.u1 - fw, y0: h.y0, y1: h.y0 + fw }, d0, d1));
        glasses.push(
          this.wallBox(room, side, { u0: h.u0 + fw, u1: h.u1 - fw, y0: h.y0 + fw, y1: h.y1 - fw }, t / 2 - 0.5, t / 2 + 0.5),
        );
      }
    }
    if (frames.length) {
      parent.add(
        new THREE.Mesh(
          mergeGeometries(frames),
          fade(new THREE.MeshStandardMaterial({ color: COLORS.frame, roughness: 0.7 }), 0.15),
        ),
      );
      frames.forEach((g) => g.dispose());
    }
    if (glasses.length) {
      const glassMat = fade(
        new THREE.MeshStandardMaterial({ color: COLORS.glass, roughness: 0.1, opacity: 0.35, depthWrite: false }),
        0.06,
      );
      parent.add(new THREE.Mesh(mergeGeometries(glasses), glassMat));
      glasses.forEach((g) => g.dispose());
    }

    // Nom du mur, posé au sol devant son parement intérieur.
    const label = this.makeLabel(WALL_LABELS[side]);
    const labelSize = Math.max(30, Math.min(room.length, room.width) * 0.12);
    label.scale.set(labelSize * 2, labelSize * 0.5, 1);
    label.position.copy(p(len / 2, 2, -labelSize * 0.6));
    parent.add(label);

    const normalBySide: Record<WallSide, [number, number, number]> = {
      nord: [0, 0, -1],
      sud: [0, 0, 1],
      est: [1, 0, 0],
      ouest: [-1, 0, 0],
    };
    return {
      side,
      fadeables,
      normal: new THREE.Vector3(...normalBySide[side]),
      outerPoint: p(len / 2, H / 2, t),
      faded: false,
    };
  }

  private makeLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '600 38px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(60, 40, 25, 0.85)';
    ctx.fillText(text.toUpperCase(), 128, 34);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
    sprite.center.set(0.5, 0);
    return sprite;
  }

  private buildGrid(L: number, W: number, step: number): THREE.LineSegments {
    const pts: number[] = [];
    const y = 0.2; // légèrement au-dessus du sol pour éviter le scintillement
    for (let x = 0; x <= L + 0.001; x += step) pts.push(x, y, 0, x, y, W);
    for (let z = 0; z <= W + 0.001; z += step) pts.push(0, y, z, L, y, z);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(
      geom,
      new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.45 }),
    );
  }

  /** Estompe les murs situés entre la caméra et l'intérieur (vue « maison de poupée »). */
  private updateWallVisibility(): void {
    for (const w of this.walls) {
      const faded = this.tmp.copy(this.camera.position).sub(w.outerPoint).dot(w.normal) > 0;
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

  private tick(): void {
    // update() renvoie true tant que l'amortissement fait bouger la caméra.
    const moving = this.controls.update();
    if (!moving && !this.needsRender) return;
    this.needsRender = false;
    this.updateWallVisibility();
    this.renderer.render(this.scene, this.camera);
  }
}
