import { useEffect, useState, type FormEvent } from 'react';
import { Button, Modal } from '@/components/ui';
import { baseBpm } from '@/features/chart/runtime/commands';
import { ProjectFields } from '../ProjectFields/ProjectFields';
import { ExportModal } from '../ExportModal/ExportModal';
import { projectRepo } from '../projectRepo';
import { useProjectStore } from '../useProjectStore';
import type { Project, ProjectFormValues } from '../types';
import styles from './ManageProjectsModal.module.css';

interface ManageProjectsModalProps {
  open: boolean;
  onClose: () => void;
}

const FORM_ID = 'manage-project-form';

export function ManageProjectsModal({ open, onClose }: ManageProjectsModalProps) {
  const selectedId = useProjectStore((s) => s.selectedId);
  if (!open) return null;
  return <ManageDialog key={selectedId} id={selectedId} onClose={onClose} />;
}

function ManageDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { update } = useProjectStore.getState();
  const [project, setProject] = useState<Project | null>(null);
  const [form, setForm] = useState<ProjectFormValues | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    void projectRepo.get(id).then((p) => {
      if (!p) return;
      setProject(p);
      setForm({
        name: p.meta.name,
        artist: p.meta.artist,
        illustrator: p.meta.illustrator ?? '',
        charter: p.meta.charter,
        difficulty: p.meta.difficulty ?? '',
        bpm: baseBpm(p.chart),
      });
    });
  }, [id]);

  const set = <K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) =>
    setForm((f) => f && { ...f, [key]: value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!id || !form) return;
    await update(id, form);
    onClose();
  };

  return (
    <Modal
      open
      title="Manage Project"
      onClose={onClose}
      footer={
        <>
          <div className={styles.actions}>
            <Button variant="ghost" onClick={() => setExportOpen(true)} disabled={!project}>
              Export
            </Button>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={FORM_ID} disabled={!form?.name.trim()}>
            Save
          </Button>
        </>
      }
    >
      {form ? (
        <form id={FORM_ID} className={styles.form} onSubmit={submit}>
          <ProjectFields
            form={form}
            set={set}
            hasAudio={!!project?.audio}
            hasIllustration={!!project?.illustration}
          />
        </form>
      ) : (
        <p className={styles.empty}>{id ? 'Loading…' : 'No project selected.'}</p>
      )}
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        load={async () => project}
      />
    </Modal>
  );
}
