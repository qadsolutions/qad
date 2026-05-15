import EmptyState from '../components/ui/EmptyState';

// Tasks are surfaced from exceptions that need human action.
// Phase 5 placeholder — full task management wired in Phase 6.
export default function Tasks() {
  return (
    <div className="fade-in">
      <EmptyState
        icon="check"
        title="No open tasks"
        description="The automation is handling everything right now. Tasks requiring human input will appear here."
      />
    </div>
  );
}
