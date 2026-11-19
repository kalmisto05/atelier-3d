import type { Project } from './types';

export type ChangeSource = 'user' | 'load';
type Listener = (project: Project, source: ChangeSource) => void;

/** Conteneur d'état unique : toute modification passe par `update` pour notifier la vue et la sauvegarde. */
export class ProjectStore {
  private listeners = new Set<Listener>();

  constructor(private current: Project) {}

  get project(): Project {
    return this.current;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(mutate: (draft: Project) => void): void {
    mutate(this.current);
    this.current.updatedAt = new Date().toISOString();
    this.emit('user');
  }

  replace(project: Project): void {
    this.current = project;
    this.emit('load');
  }

  private emit(source: ChangeSource): void {
    for (const l of this.listeners) l(this.current, source);
  }
}
