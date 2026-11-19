import type { Room } from '../model/types';
import { getActiveRoom } from '../model/factory';
import type { ProjectStore } from '../model/store';
import { bindNumberFields, escapeHtml, type NumberAdapter } from './fields';

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

  constructor(
    protected store: ProjectStore,
    title: string,
    intro: string,
    actions: string,
  ) {
    this.root = document.createElement('details');
    this.root.className = 'section';
    this.root.open = true;
    this.root.innerHTML = `
      <summary><h2>${title}</h2></summary>
      ${intro ? `<p class="hint">${intro}</p>` : ''}
      <div class="item-list"></div>
      ${actions ? `<div class="button-row">${actions}</div>` : ''}
    `;
    this.list = this.root.querySelector('.item-list')!;
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
  /** Mises à jour légères sans reconstruction (alertes, textes calculés). */
  protected update(_room: Room): void {}

  refresh(): void {
    const room = this.room;
    const sig = this.signature(room);
    if (sig !== this.lastSignature) {
      this.lastSignature = sig;
      this.list.innerHTML = this.renderItems(room);
    }
    this.update(room);
  }

  protected card(id: string): HTMLElement | null {
    return this.list.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  }

  /** Après un ajout : fait défiler jusqu'à l'élément et donne le focus à son premier champ. */
  protected reveal(id: string): void {
    const card = this.card(id);
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    card?.querySelector<HTMLElement>('select, input')?.focus({ preventScroll: true });
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
