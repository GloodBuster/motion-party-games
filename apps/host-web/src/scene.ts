import * as THREE from 'three';
import {
  BALL_RADIUS,
  BALL_START_Z,
  HEAD_PIN_Z,
  LANE_HALF_WIDTH,
  LANE_WIDTH,
  PIN_HEIGHT,
  type BallPose,
  type PinPose,
} from './bowling-physics.js';

/**
 * Escena 3D de la pista de bolos en Three.js con madera procedural,
 * pinos torneados con franjas rojas, guía de apuntado y cámara dinámica.
 */
export class BowlingScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly ballMesh: THREE.Group;
  private readonly ballSurfaceMat: THREE.MeshPhysicalMaterial;
  private readonly pinMeshes: THREE.Mesh[] = [];
  private readonly aimGuideGroup: THREE.Group;
  private readonly aimLine: THREE.Line;

  private readonly camTargetPos = new THREE.Vector3(0, 1.55, 3.25);
  private readonly camLookAt = new THREE.Vector3(0, 0.35, -10);
  private readonly camCurrentLook = new THREE.Vector3(0, 0.35, -10);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#070b18');
    this.scene.fog = new THREE.Fog('#070b18', 22, 46);

    this.camera = new THREE.PerspectiveCamera(
      46,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.1,
      80,
    );
    this.camera.position.copy(this.camTargetPos);
    this.camera.lookAt(this.camLookAt);

    this.setupLights();
    this.buildAlleyEnvironment();

    const { group, surfaceMat } = this.createBallMesh();
    this.ballMesh = group;
    this.ballSurfaceMat = surfaceMat;
    this.scene.add(this.ballMesh);

    this.createPinMeshes();

    const { aimGroup, aimLine } = this.createAimGuide();
    this.aimGuideGroup = aimGroup;
    this.aimLine = aimLine;
    this.scene.add(this.aimGuideGroup);

    window.addEventListener('resize', this.handleResize);
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight('#c7d2fe', '#1e293b', 0.85);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fff7ed', 1.45);
    keyLight.position.set(2.5, 6.5, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 35;
    keyLight.shadow.camera.left = -4;
    keyLight.shadow.camera.right = 4;
    keyLight.shadow.camera.top = 15;
    keyLight.shadow.camera.bottom = -15;
    this.scene.add(keyLight);

    // Foco cálido sobre la cubierta de pinos
    const pinSpot = new THREE.SpotLight('#ffffff', 2.6, 12, Math.PI / 4, 0.55, 1.2);
    pinSpot.position.set(0, 3.6, HEAD_PIN_Z + 1.1);
    pinSpot.target.position.set(0, 0, HEAD_PIN_Z - 0.5);
    pinSpot.castShadow = true;
    this.scene.add(pinSpot);
    this.scene.add(pinSpot.target);

    // Acento neón suave en los laterales
    const cyanGlow = new THREE.PointLight('#38bdf8', 1.2, 18);
    cyanGlow.position.set(-2.2, 1.8, -8);
    this.scene.add(cyanGlow);

    const magentaGlow = new THREE.PointLight('#c084fc', 1.1, 18);
    magentaGlow.position.set(2.2, 1.8, -14);
    this.scene.add(magentaGlow);
  }

  private buildAlleyEnvironment(): void {
    // Textura procedural de madera de arce + flechas + línea de falta
    const woodTexture = this.createLaneWoodTexture();
    const laneMat = new THREE.MeshStandardMaterial({
      map: woodTexture,
      roughness: 0.22,
      metalness: 0.06,
    });

    const laneGeo = new THREE.BoxGeometry(LANE_WIDTH, 0.2, 23.0);
    const laneMesh = new THREE.Mesh(laneGeo, laneMat);
    laneMesh.position.set(0, -0.1, -8.8);
    laneMesh.receiveShadow = true;
    this.scene.add(laneMesh);

    // Canaletas laterales
    const gutterMat = new THREE.MeshStandardMaterial({
      color: '#172033',
      roughness: 0.45,
      metalness: 0.35,
    });
    for (const side of [-1, 1]) {
      const gutter = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 23.0), gutterMat);
      gutter.position.set(side * 0.67, -0.16, -8.8);
      gutter.receiveShadow = true;
      this.scene.add(gutter);

      // Riel lateral con tira LED neón
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.24, 23.5),
        new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.5, metalness: 0.4 }),
      );
      rail.position.set(side * 0.9, 0.02, -8.8);
      this.scene.add(rail);

      const neonStrip = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, 0.03, 22.8),
        new THREE.MeshBasicMaterial({ color: side < 0 ? '#38bdf8' : '#a855f7' }),
      );
      neonStrip.position.set(side * 0.815, 0.12, -8.8);
      this.scene.add(neonStrip);
    }

    // Suelo de fondo / zona de bolera
    const hallFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 42),
      new THREE.MeshStandardMaterial({ color: '#0b1120', roughness: 0.85 }),
    );
    hallFloor.rotation.x = -Math.PI / 2;
    hallFloor.position.set(0, -0.22, -9);
    this.scene.add(hallFloor);

    // Estructura del pinsetter trasero (cabecera luminosa al fondo de la pista)
    const hoodMat = new THREE.MeshStandardMaterial({
      color: '#111827',
      roughness: 0.4,
      metalness: 0.5,
    });
    const backHood = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 0.5), hoodMat);
    backHood.position.set(0, 1.38, -20.9);
    this.scene.add(backHood);

    const hoodAccent = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.08, 0.08),
      new THREE.MeshBasicMaterial({ color: '#38bdf8' }),
    );
    hoodAccent.position.set(0, 0.72, -20.62);
    this.scene.add(hoodAccent);

    const pitBackdrop = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.6, 0.2),
      new THREE.MeshStandardMaterial({ color: '#060913', roughness: 0.9 }),
    );
    pitBackdrop.position.set(0, 0.4, -22.0);
    this.scene.add(pitBackdrop);
  }

  private createLaneWoodTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 2048;
    const ctx = canvas.getContext('2d')!;

    // Duelas longitudinales de madera
    const plankCount = 26;
    const plankW = canvas.width / plankCount;
    for (let i = 0; i < plankCount; i++) {
      const shade = 205 + ((i * 19) % 28) - 14;
      ctx.fillStyle = `rgb(${shade}, ${Math.round(shade * 0.76)}, ${Math.round(shade * 0.44)})`;
      ctx.fillRect(i * plankW, 0, plankW + 1, canvas.height);

      ctx.strokeStyle = 'rgba(92, 56, 24, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(i * plankW, 0);
      ctx.lineTo(i * plankW, canvas.height);
      ctx.stroke();
    }

    // Línea de falta negra cerca de z = 0 (~87% desde arriba en la textura)
    const foulY = Math.round(canvas.height * 0.87);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, foulY, canvas.width, 16);

    // 7 flechas de apuntado clásicas
    ctx.fillStyle = '#1e293b';
    const arrowYBase = Math.round(canvas.height * 0.66);
    for (let i = -3; i <= 3; i++) {
      const cx = canvas.width / 2 + i * 56;
      const cy = arrowYBase + Math.abs(i) * 26;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 28);
      ctx.lineTo(cx - 10, cy + 16);
      ctx.lineTo(cx + 10, cy + 16);
      ctx.closePath();
      ctx.fill();
    }

    // Puntos guía cerca de la línea de falta
    for (let i = -3; i <= 3; i++) {
      const cx = canvas.width / 2 + i * 56;
      ctx.beginPath();
      ctx.arc(cx, foulY - 60, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }

  private createBallMesh(): {
    group: THREE.Group;
    surfaceMat: THREE.MeshPhysicalMaterial;
  } {
    const group = new THREE.Group();

    const surfaceMat = new THREE.MeshPhysicalMaterial({
      color: '#38bdf8',
      roughness: 0.14,
      metalness: 0.28,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 32, 24), surfaceMat);
    sphere.castShadow = true;
    group.add(sphere);

    // 3 agujeros para dedos (hacen súper visible la rotación y el efecto hook)
    const holeMat = new THREE.MeshBasicMaterial({ color: '#050814' });
    const holeOffsets: Array<[number, number, number]> = [
      [-0.022, 0.085, 0.06],
      [0.022, 0.085, 0.06],
      [0, 0.045, 0.095],
    ];
    for (const [hx, hy, hz] of holeOffsets) {
      const hole = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 10), holeMat);
      hole.position.set(hx, hy, hz);
      group.add(hole);
    }

    return { group, surfaceMat };
  }

  private createPinMeshes(): void {
    // Perfil torneado de un pino de bolos clásico (altura = PIN_HEIGHT = 0.381 m)
    const points = [
      new THREE.Vector2(0.028, 0.0),
      new THREE.Vector2(0.048, 0.055),
      new THREE.Vector2(0.06, 0.115),
      new THREE.Vector2(0.056, 0.17),
      new THREE.Vector2(0.036, 0.23),
      new THREE.Vector2(0.024, 0.275),
      new THREE.Vector2(0.032, 0.32),
      new THREE.Vector2(0.033, 0.355),
      new THREE.Vector2(0.022, 0.376),
      new THREE.Vector2(0.0, PIN_HEIGHT),
    ];

    const latheGeo = new THREE.LatheGeometry(points, 20);
    // Centrar verticalmente alrededor de 0 para coincidir con el cuerpo rígido de Rapier
    latheGeo.translate(0, -PIN_HEIGHT / 2, 0);

    const pinTex = this.createPinStripeTexture();
    const pinMat = new THREE.MeshPhysicalMaterial({
      map: pinTex,
      roughness: 0.18,
      clearcoat: 0.85,
      clearcoatRoughness: 0.12,
    });

    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(latheGeo, pinMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.pinMeshes.push(mesh);
    }
  }

  private createPinStripeTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 64, 256);

    // Dos franjas rojas en el cuello del pino
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(0, 62, 64, 13);
    ctx.fillRect(0, 84, 64, 13);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createAimGuide(): { aimGroup: THREE.Group; aimLine: THREE.Line } {
    const aimGroup = new THREE.Group();

    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.02, 0),
      new THREE.Vector3(0, 0.02, -5.8),
    ]);
    const lineMat = new THREE.LineBasicMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.8,
    });
    const aimLine = new THREE.Line(lineGeo, lineMat);
    aimGroup.add(aimLine);

    const arrowCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.22, 16),
      new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.9 }),
    );
    arrowCone.rotation.x = -Math.PI / 2;
    arrowCone.position.set(0, 0.03, -5.9);
    aimGroup.add(arrowCone);

    return { aimGroup, aimLine };
  }

  setBallColor(hexColor: string): void {
    this.ballSurfaceMat.color.set(hexColor);
  }

  updateAimGuide(visible: boolean, laneOffset: number, aimAngleDeg: number, liveRollDeg: number): void {
    this.aimGuideGroup.visible = visible;
    if (!visible) return;

    const startX = laneOffset * (LANE_HALF_WIDTH - BALL_RADIUS - 0.03);
    this.aimGuideGroup.position.set(startX, 0.008, BALL_START_Z - 0.15);
    this.aimGuideGroup.rotation.y = (-aimAngleDeg * Math.PI) / 180;

    // Curva sutil de vista previa según inclinación en vivo de la muñeca
    const spinCurve = Math.max(-1, Math.min(1, liveRollDeg / 45)) * 0.45;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      pts.push(new THREE.Vector3(spinCurve * t * t, 0.02, -t * 5.8));
    }
    this.aimLine.geometry.setFromPoints(pts);
  }

  syncPhysics(ball: BallPose, pins: PinPose[], mode: 'aiming' | 'rolling' | 'result'): void {
    this.ballMesh.position.set(ball.position.x, ball.position.y, ball.position.z);
    this.ballMesh.quaternion.set(
      ball.rotation.x,
      ball.rotation.y,
      ball.rotation.z,
      ball.rotation.w,
    );

    for (let i = 0; i < pins.length; i++) {
      const p = pins[i]!;
      const mesh = this.pinMeshes[i]!;
      mesh.visible = p.active;
      if (p.active) {
        mesh.position.set(p.position.x, p.position.y, p.position.z);
        mesh.quaternion.set(p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w);
      }
    }

    // Cámara dinámica suave estilo Wii Sports
    if (mode === 'aiming') {
      this.camTargetPos.set(ball.position.x * 0.45, 1.52, 3.2);
      this.camLookAt.set(ball.position.x * 0.35, 0.32, -10.5);
    } else if (mode === 'rolling') {
      const followZ = Math.max(HEAD_PIN_Z + 5.2, ball.position.z + 3.4);
      this.camTargetPos.set(ball.position.x * 0.42, 1.38, followZ);
      this.camLookAt.set(ball.position.x * 0.25, 0.25, Math.min(ball.position.z - 5.5, HEAD_PIN_Z));
    } else {
      this.camTargetPos.set(0.35, 1.48, HEAD_PIN_Z + 4.4);
      this.camLookAt.set(0, 0.22, HEAD_PIN_Z - 0.5);
    }
  }

  render(dtSeconds: number): void {
    const lerpAlpha = 1 - Math.exp(-5.5 * dtSeconds);
    this.camera.position.lerp(this.camTargetPos, lerpAlpha);
    this.camCurrentLook.lerp(this.camLookAt, lerpAlpha);
    this.camera.lookAt(this.camCurrentLook);
    this.renderer.render(this.scene, this.camera);
  }

  private readonly handleResize = (): void => {
    this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
  }
}
