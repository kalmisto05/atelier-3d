import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Room, WallSide } from '../model/types';

/** Unité de la scène : 1 = 1 cm, comme le modèle. */

const COLORS = {
  background: 0x2a2420,
  floor: 0xd9c3a5,
  grid: 0x9c8366,
  wall: 0xf1ece4,
  wallEdge: 0x7a6a58,
};

interface WallMesh {
  side: WallSide;
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  /** Normale sortante et point du parement extérieur, dans le repère de la pièce. */
  normal: THREE.Vector3;
  outerPoint: THREE.Vector3;
}

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  /** Groupe centré sur la pièce : l'origine de la scène est au centre du sol. */
  private roomGroup = new THREE.Group();
  private walls: WallMesh[] = [];
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

  /** Reconstruit la géométrie de la pièce. Recadre la caméra seulement si les dimensions ont changé. */
  setRoom(room: Room, options: { reframe?: boolean } = {}): void {
    const key = [room.id, room.length, room.width, room.height, ...room.walls.map((w) => w.thickness)].join('|');
    const changed = key !== this.lastRoomKey;
    this.lastRoomKey = key;
    if (!changed && !options.reframe) return;

    this.clearRoom();
    this.buildRoom(room);
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
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m: THREE.Material) => m.dispose());
      }
    });
    this.roomGroup.clear();
    this.walls = [];
  }

  private buildRoom(room: Room): void {
    const { length: L, width: W, height: H } = room;
    // Le repère de la pièce a son origine au coin intérieur ; on le décale pour centrer la vue.
    const content = new THREE.Group();
    content.position.set(-L / 2, 0, -W / 2);
    this.roomGroup.add(content);

    // Sol
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(L, W),
      new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(L / 2, 0, W / 2);
    content.add(floor);
    content.add(this.buildGrid(L, W, 50));

    // Murs
    const t = Object.fromEntries(room.walls.map((w) => [w.side, w.thickness])) as Record<WallSide, number>;
    const specs: { side: WallSide; size: [number, number, number]; center: [number, number, number]; normal: [number, number, number] }[] = [
      { side: 'nord', size: [L + t.ouest + t.est, H, t.nord], center: [(L + t.est - t.ouest) / 2, H / 2, -t.nord / 2], normal: [0, 0, -1] },
      { side: 'sud', size: [L + t.ouest + t.est, H, t.sud], center: [(L + t.est - t.ouest) / 2, H / 2, W + t.sud / 2], normal: [0, 0, 1] },
      { side: 'ouest', size: [t.ouest, H, W], center: [-t.ouest / 2, H / 2, W / 2], normal: [-1, 0, 0] },
      { side: 'est', size: [t.est, H, W], center: [L + t.est / 2, H / 2, W / 2], normal: [1, 0, 0] },
    ];

    for (const s of specs) {
      const geom = new THREE.BoxGeometry(...s.size);
      const mesh = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.95, transparent: true }),
      );
      mesh.position.set(...s.center);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geom),
        new THREE.LineBasicMaterial({ color: COLORS.wallEdge, transparent: true }),
      );
      edges.position.copy(mesh.position);
      content.add(mesh, edges);

      const normal = new THREE.Vector3(...s.normal);
      const halfDepth = normal.x !== 0 ? s.size[0] / 2 : s.size[2] / 2;
      const outerPoint = mesh.position.clone().addScaledVector(normal, halfDepth).add(content.position);
      this.walls.push({ side: s.side, mesh, edges, normal, outerPoint });
    }
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

  /** Rend presque invisibles les murs situés entre la caméra et l'intérieur (vue « maison de poupée »). */
  private updateWallVisibility(): void {
    for (const w of this.walls) {
      const facingCamera = this.tmp.copy(this.camera.position).sub(w.outerPoint).dot(w.normal) > 0;
      const opacity = facingCamera ? 0.12 : 1;
      if (w.mesh.material.opacity !== opacity) {
        w.mesh.material.opacity = opacity;
        w.mesh.material.depthWrite = !facingCamera;
        w.edges.material.opacity = facingCamera ? 0.35 : 1;
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
