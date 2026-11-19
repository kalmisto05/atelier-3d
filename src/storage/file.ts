import type { Project } from '../model/types';
import { parseProject } from '../model/migrate';

function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'projet'
  );
}

export function exportProject(project: Project): void {
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(project.name)}-${date}.atelier3d.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Ouvre le sélecteur de fichier et renvoie le projet validé, ou null si l'utilisateur annule. */
export function pickProjectFile(): Promise<Project | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    // Sur Android, un filtre trop strict masque parfois les fichiers : on accepte aussi le texte brut.
    input.accept = '.json,application/json,text/plain';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const text = await file.text();
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error("Le fichier n'est pas un JSON valide.");
        }
        resolve(parseProject(data));
      } catch (err) {
        reject(err);
      }
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
