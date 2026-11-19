import type { Room } from '../model/types';
import { getActiveRoom } from '../model/factory';
import type { ProjectStore } from '../model/store';
import { bindNumberFields, escapeHtml, type NumberAdapter } from './fields';

export type ItemKind = 'wall' | 'opening' | 'outlet' | 'obstacle';

/** Événement émis quand l'utilisateur travaille dans une fiche (pour la mettre en évidence en 3D). */
export const ITEM_FOCUS_EVENT = 'itemfocus';
export interface ItemFocusDetail {
  kind: ItemKind;
  id: string;
}

/**
 * Section repliable du panneau contenant une liste d'éléments éditables.
 *
 * La liste n'est reconstruite que lorsque sa structure change (ajout, suppression,
 * changement de mur, chargement…), jamais pendant une saisie : le champ en cours
 * d'édition garde ainsi le focus.
 */
export abstract class ListSection {
  readonly root: HTMLDetailsElement;
  protected list: HTMLElement;
  private lastSignature = '';
  private selectedId: string | null = null;

  constructor(
    protected store: ProjectStore,
    readonly kind: ItemKind,
    title: string,
    intro: string,
    actions: string,
  ) {
    this.root = document.createElement('details');
    this.root.className = 'section';
    // Repliée à l'ouverture de l'appli, pour un panneau lisible d'un coup d'œil.
    this.root.open = false;
    this.root.innerHTML = `
      <summary><h2>${title}</h2><span class="count"></span></summary>
      ${intro ? `<p class="hint">${intro}</p>` : ''}
      <div class="item-list"></div>
      ${actions ? `<div class="button-row">${actions}</div>` : ''}
    `;
    this.list = this.root.querySelector('.item-list')!;

    this.list.addEventListener('focusin', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.item-card[data-id]');
      if (!card) return;
      this.root.dispatchEvent(
        new CustomEvent<ItemFocusDetail>(ITEM_FOCUS_EVENT, { bubbles: true, detail: { kind: this.kind, id: card.dataset.id! } }),
      );
    });
  }

  /** À appeler à la fin du constructeur des sous-classes. */
  protected init(adapter: NumberAdapter): void {
    bindNumberFields(this.list, this.store, adapter);
    this.store.subscribe(() => this.refresh());
    this.refresh();
  }

  protected get room(): Room {
    return getActiveRoom(this.store.project);
  }

  /** Empreinte de la structure de la liste : si elle change, on reconstruit. */
  protected abstract signature(room: Room): string;
  protected abstract renderItems(room: Room): string;
  /** Nombre d'éléments affiché à côté du titre de la section repliée. */
  protected abstract count(room: Room): number;
  /** Mises à jour légères sans reconstruction (alertes, textes calculés). */
  protected update(_room: Room): void {}

  refresh(): void {
    const room = this.room;
    const sig = this.signature(room);
    if (sig !== this.lastSignature) {
      this.lastSignature = sig;
      this.list.innerHTML = this.renderItems(room);
      this.markSelected();
    }
    const n = this.count(room);
    this.root.querySelector('.count')!.textContent = n ? String(n) : '';
    this.update(room);
  }

  protected card(id: string): HTMLElement | null {
    return this.list.querySelector<HTMLElement>(`.item-card[data-id="${CSS.escape(id)}"]`);
  }

  /** Après un ajout : fait défiler jusqu'à l'élément et donne le focus à son premier champ. */
  protected reveal(id: string): void {
    this.root.open = true;
    const card = this.card(id);
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    card?.querySelector<HTMLElement>('select, input')?.focus({ preventScroll: true });
  }

  /**
   * Élément choisi dans la vue 3D : ouvre la section, met la fiche en évidence et la fait défiler.
   * `focusKey` désigne un champ à activer directement (ex. le renfoncement sous une fenêtre).
   */
  select(id: string | null, focusKey?: string): void {
    this.selectedId = id;
    this.markSelected();
    if (!id) return;
    this.root.open = true;
    const card = this.card(id);
    if (!card) return;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (focusKey) {
      const input = card.querySelector<HTMLInputElement>(`input[data-key="${focusKey}"]`);
      input?.focus({ preventScroll: true });
      input?.select();
    }
  }

  private markSelected(): void {
    this.list.querySelectorAll('.item-card.selected').forEach((c) => c.classList.remove('selected'));
    if (this.selectedId) this.card(this.selectedId)?.classList.add('selected');
  }

  /** Liste déroulante des murs. */
  protected wallSelect(uid: string, room: Room, selectedId: string): string {
    const options = room.walls
      .map((w, i) => {
        const label = escapeHtml(w.name ? `Mur ${i + 1} · ${w.name}` : `Mur ${i + 1}`);
        return `<option value="${w.id}"${w.id === selectedId ? ' selected' : ''}>${label}</option>`;
      })
      .join('');
    return `
      <label class="field" for="${uid}-wall">
        <span>Mur</span>
        <select id="${uid}-wall" data-wall-select>${options}</select>
      </label>`;
  }
}
