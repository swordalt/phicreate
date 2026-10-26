import { useState, type ReactNode } from 'react';
import { useEditorStore } from '../useEditorStore';
import { EventProperties } from './EventProperties';
import { Section } from './fields';
import { ObjectProperties } from './ObjectProperties';
import { MetadataPanel } from './MetadataPanel';
import { MultiEventEdit, MultiNoteEdit } from './MultiEdit';
import { NoteProperties } from './NoteProperties';
import { TimingPanel } from './TimingPanel';
import styles from './SidePanel.module.css';

export function SidePanel() {
  const activeGrid = useEditorStore((s) => s.activeGrid);
  const count = useEditorStore((s) =>
    s.activeGrid === 'events' ? s.selectedEventIds.length : s.selectedNoteIds.length,
  );
  const hasSelection = count > 0;
  const objectPanelOpen = useEditorStore((s) => s.objectPanelOpen);

  // Back to the general view.
  const close = () =>
    useEditorStore.getState().set({
      selectedNoteIds: [],
      selectedEventIds: [],
      objectPanelOpen: false,
    });

  // A selection replaces the sidebar with its properties editor.
  if (hasSelection) {
    const events = activeGrid === 'events';
    return (
      <Panel title="Properties" onClose={close}>
        <Section title={events ? 'Event properties' : 'Note properties'}>
          {events ? <EventProperties /> : <NoteProperties />}
        </Section>
        {count > 1 && (
          <Section title="Multi edit">{events ? <MultiEventEdit /> : <MultiNoteEdit />}</Section>
        )}
      </Panel>
    );
  }

  if (objectPanelOpen) {
    return (
      <Panel title="Properties" onClose={close}>
        <ObjectProperties />
      </Panel>
    );
  }

  return (
    <Panel title="Functions">
      <FeatureNav />
    </Panel>
  );
}

function Panel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose?: () => void;
  children: ReactNode;
}) {
  return (
    <aside className={styles.panel}>
      <header className={styles.title}>
        <h1>{title}</h1>
        {onClose && (
          <button type="button" className={styles.inlineAction} title="Close" onClick={onClose}>
            ×
          </button>
        )}
      </header>
      {children}
    </aside>
  );
}

const FEATURES: { id: string; label: string; panel: () => ReactNode }[] = [
  { id: 'metadata', label: 'Metadata', panel: () => <MetadataPanel /> },
  { id: 'timing', label: 'Timing & BPM', panel: () => <TimingPanel /> },
];

// One feature expanded at a time.
function FeatureNav() {
  const [open, setOpen] = useState<string | null>('metadata');
  return (
    <nav className={styles.nav}>
      {FEATURES.map((f) => (
        <div key={f.id}>
          <button
            type="button"
            className={f.id === open ? styles.navButtonOpen : styles.navButton}
            onClick={() => setOpen(f.id === open ? null : f.id)}
          >
            <span>{f.label}</span>
            <span>{f.id === open ? '▾' : '▸'}</span>
          </button>
          {f.id === open && <div className={styles.navBody}>{f.panel()}</div>}
        </div>
      ))}
    </nav>
  );
}
