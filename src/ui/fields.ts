import type { Room } from '../model/types';
import { clamp, getActiveRoom } from '../model/factory';
import type { ProjectStore } from '../model/store';

export interface Limits {
  min: number;
  max: number;
}

/** Accès aux valeurs numériques des éléments d'une liste (repérés par leur id). */
export interface NumberAdapter {
  get(room: Room, id: string, key: string): number | undefined;
  set(room: Room, id: string, key: string, value: number): void;
  limits(room: Room, id: string, key: string): Limits | undefined;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Champ numérique avec son unité ; `data-key` identifie la grandeur modifiée. */
export function numberField(uid: string, key: string, label: string, value: number, unit = 'cm'): string {
  return `
    <label class="field" for="${uid}-${key}">
      <span>${label}</span>
      <span class="input-unit">
        <input id="${uid}-${key}" data-key="${key}" type="number" inputmode="decimal" step="any" value="${value}" />
        <span class="unit">${unit}</span>
      </span>
    </label>`;
}

/**
 * Branche les champs numériques d'un conteneur sur le store :
 * - pendant la saisie, la vue se met à jour en direct si la valeur est dans les bornes ;
 * - à la validation (perte de focus, Entrée), la valeur est ramenée dans les bornes.
 * L'élément modifié est repéré par l'attribut `data-id` de son plus proche ancêtre.
 */
export function bindNumberFields(container: HTMLElement, store: ProjectStore, adapter: NumberAdapter): void {
  const target = (e: Event) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.type !== 'number' || !el.dataset.key) return null;
    const id = el.closest<HTMLElement>('[data-id]')?.dataset.id;
    return id ? { el, id, key: el.dataset.key } : null;
  };
  const parse = (el: HTMLInputElement) => (el.value === '' ? NaN : Number(el.value.replace(',', '.')));

  container.addEventListener('input', (e) => {
    const t = target(e);
    if (!t) return;
    const room = getActiveRoom(store.project);
    const lim = adapter.limits(room, t.id, t.key);
    const v = parse(t.el);
    const valid = !!lim && Number.isFinite(v) && v >= lim.min && v <= lim.max;
    t.el.classList.toggle('invalid', !valid);
    if (valid) store.update((p) => adapter.set(getActiveRoom(p), t.id, t.key, v));
  });

  container.addEventListener('change', (e) => {
    const t = target(e);
    if (!t) return;
    const room = getActiveRoom(store.project);
    const current = adapter.get(room, t.id, t.key);
    const lim = adapter.limits(room, t.id, t.key);
    if (current === undefined || !lim) return;
    const v = parse(t.el);
    const fixed = Number.isFinite(v) ? clamp(Math.round(v * 10) / 10, lim.min, lim.max) : current;
    t.el.value = String(fixed);
    t.el.classList.remove('invalid');
    if (fixed !== current) store.update((p) => adapter.set(getActiveRoom(p), t.id, t.key, fixed));
  });
}
