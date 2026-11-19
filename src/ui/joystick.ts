/**
 * Joystick tactile pour la visite : on pose le pouce dans le cercle et on le fait glisser.
 * Renvoie une commande entre −1 et 1 sur chaque axe (x vers la droite, y vers le bas).
 */
export function createJoystick(onChange: (x: number, y: number) => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'joystick';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="joystick-knob"></div>';
  const knob = el.querySelector<HTMLElement>('.joystick-knob')!;

  let pointer: number | null = null;
  const move = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const radius = r.width / 2;
    let x = e.clientX - (r.left + radius);
    let y = e.clientY - (r.top + radius);
    const d = Math.hypot(x, y);
    if (d > radius) {
      x = (x / d) * radius;
      y = (y / d) * radius;
    }
    knob.style.transform = `translate(${x}px, ${y}px)`;
    onChange(x / radius, y / radius);
  };
  const release = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    knob.style.transform = '';
    onChange(0, 0);
  };

  el.addEventListener('pointerdown', (e) => {
    if (pointer !== null) return;
    pointer = e.pointerId;
    el.setPointerCapture(e.pointerId);
    move(e);
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId === pointer) move(e);
  });
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  return el;
}
