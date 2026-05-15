import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import EmptyState from '../components/ui/EmptyState';
import { SkeletonCard } from '../components/ui/Skeleton';

const SEVERITY = {
  workflow_failure: { level: 'HIGH',   color: 'border-rose-400',  Icon: AlertCircle, iconColor: 'text-rose-500' },
  pending_review:   { level: 'MEDIUM', color: 'border-amber-400', Icon: AlertTriangle, iconColor: 'text-amber-500' },
  human_review:     { level: 'MEDIUM', color: 'border-amber-400', Icon: AlertTriangle, iconColor: 'text-amber-500' },
  pending:          { level: 'LOW',    color: 'border-slate-300', Icon: Info,          iconColor: 'text-slate-400' },
};

const AUTOMATION_LABELS = {
  intake: 'Customer Intake',
  documents: 'Document Processing',
  appointments: 'Appointment Scheduling',
  system: 'System',
};

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = (Date.now() - new Date(ts)) / 1000;
  if (diff < 60)   return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function ExceptionCard({ item }) {
  const sev = SEVERITY[item.exception_type] || SEVERITY.pending;
  const { Icon } = sev;

  return (
    <div className={`bg-white rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] border-l-4 ${sev.color} p-5`}>
      <div className="flex items-start gap-3">
        <Icon size={18} className={`mt-0.5 shrink-0 ${sev.iconColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-bold tracking-widest uppercase ${sev.iconColor}`}>{sev.level}</span>
            <span className="text-[10px] font-medium bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
              {AUTOMATION_LABELS[item.automation] || item.automation}
            </span>
            <span className="text-[11px] text-slate-400 ml-auto">{timeAgo(item.created_at)}</span>
          </div>
          <p className="text-sm font-medium text-slate-800 mb-1">
            {item.contact_name || item.contact_email || item.record_id}
          </p>
          <p className="text-sm text-slate-500">{item.description}</p>
          {item.contact_email && (
            <p className="text-xs text-slate-400 mt-1">{item.contact_email}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Exceptions() {
  const { data, loading, error } = useApi('/exceptions');

  if (loading) return <div className="space-y-3">{Array.from({length: 3}).map((_,i) => <SkeletonCard key={i} />)}</div>;
  if (error)   return <EmptyState icon="alert" title="Unable to load exceptions" description="Try refreshing the page." />;
  if (!data?.length) return (
    <EmptyState
      icon="check"
      title="All clear — no open exceptions"
      description="No exceptions right now. Everything is processing normally."
    />
  );

  return (
    <div className="space-y-3 fade-in">
      <p className="text-sm text-slate-500">{data.length} item{data.length !== 1 ? 's' : ''} needing attention</p>
      {data.map((item, i) => <ExceptionCard key={i} item={item} />)}
    </div>
  );
}
