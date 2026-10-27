import type { ProjectMeta } from '../types';
import { ProjectCard } from './ProjectCard';
import styles from './ProjectList.module.css';

interface ProjectListProps {
  projects: ProjectMeta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onManage: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string, mode: 'copy' | 'remix') => void;
}

export function ProjectList({
  projects,
  selectedId,
  onSelect,
  onOpen,
  onManage,
  onDelete,
  onDuplicate,
}: ProjectListProps) {
  return (
    <ul className={styles.list} role="listbox" aria-label="Projects">
      {projects.map((p) => (
        <li key={p.id}>
          <ProjectCard
            project={p}
            selected={p.id === selectedId}
            onSelect={() => onSelect(p.id)}
            onOpen={() => onOpen(p.id)}
            onManage={() => {
              onSelect(p.id);
              onManage(p.id);
            }}
            onDuplicate={(mode) => onDuplicate(p.id, mode)}
            onDelete={() => {
              onSelect(p.id);
              onDelete(p.id);
            }}
          />
        </li>
      ))}
    </ul>
  );
}
