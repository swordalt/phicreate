import { useEffect, useState } from 'react';
import { Button, MusicIcon, PlayIcon } from '@/components/ui';
import { timeAgo } from '@/lib/time';
import { projectRepo } from '../projectRepo';
import type { ProjectMeta } from '../types';
import styles from './ProjectCard.module.css';

interface ProjectCardProps {
  project: ProjectMeta;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onManage: () => void;
  onDelete: () => void;
  onDuplicate: (mode: 'copy' | 'remix') => void;
}

export function ProjectCard({
  project,
  selected,
  onSelect,
  onOpen,
  onManage,
  onDelete,
  onDuplicate,
}: ProjectCardProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    setThumbUrl(null);
    void projectRepo
      .getAsset(project.id, 'illustration')
      .then((blob) => {
        if (!active || !blob || blob.size === 0) return;
        url = URL.createObjectURL(blob);
        setThumbUrl(url);
      })
      .catch(() => {
        if (active) setThumbUrl(null);
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [project.id, project.updatedAt]);

  return (
    <div
      role="option"
      tabIndex={0}
      aria-selected={selected}
      className={styles.card}
      data-selected={selected || undefined}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') {
          if (selected) onOpen();
          else onSelect();
        } else if (e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <span className={styles.thumb}>
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            className={styles.thumbImg}
            onError={() => setThumbUrl(null)}
          />
        ) : (
          <MusicIcon width={28} height={28} />
        )}
      </span>

      <div className={styles.body}>
        <div className={styles.top}>
          <span className={styles.info}>
            <span className={styles.title}>
              <span className={styles.name}>{project.name}</span>
              {project.difficulty && <span className={styles.difficulty}>{project.difficulty}</span>}
            </span>
            <span className={styles.subtitle}>
              {project.artist ? (
                <>
                  <span className={styles.label}>Artist: </span>
                  <strong className={styles.value}>{project.artist}</strong>
                </>
              ) : (
                'No artist set'
              )}
            </span>
          </span>
          <span className={styles.meta}>
            {project.charter && (
              <span>
                <span className={styles.label}>Chart: </span>
                <strong className={styles.value}>{project.charter}</strong>
              </span>
            )}
            <span>Edited {timeAgo(project.updatedAt)}</span>
          </span>
        </div>

        {selected && (
          <div
            className={styles.actions}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Button size="sm" variant="danger" onClick={onDelete}>
              Delete
            </Button>
            <span className={styles.duplicate}>
              <Button size="sm" onClick={() => onDuplicate('copy')}>
                Duplicate
              </Button>
              <span className={styles.flyout}>
                <Button size="sm" onClick={() => onDuplicate('remix')}>
                  Remix
                </Button>
              </span>
            </span>
            <Button size="sm" onClick={onManage}>
              Manage
            </Button>
            <Button size="sm" variant="primary" onClick={onOpen}>
              Begin Editing <PlayIcon />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
