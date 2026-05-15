import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useClientConfig } from '../context/ClientConfigContext';
import StatusBadge from '../components/ui/StatusBadge';
import Sparkline from '../components/ui/Sparkline';
import EmptyState from '../components/ui/EmptyState';
import { SkeletonCard } from '../components/ui/Skeleton';

function timeAgo(ts) {
  if (!ts) return 'Never';
  const diff = (Date.now() - new Date(ts)) / 1000;
  if (diff < 60)   return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function AutomationRow({ automation, apiRow }) {
  const Icon = LucideIcons[automation.icon] || LucideIcons.Zap;
  const hasData = !!apiRow;
  const isHealthy = !apiRow || apiRow.last_status === 'success' || apiRow.last_status === 'partial';
  const statusLabel = !hasData ? 'No runs yet' : isHealthy ? 'Active' : 'Degraded';
  const dotColor = !hasData ? 'bg-slate-300' : isHealthy ? 'bg-emerald-500' : 'bg-amber-500';

  return (
    <div className="bg-white rounded-[10px] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] hover:shadow-[0_4px_6px_rgba(0,0,0,0.07)] transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
            <Icon size={20} className="text-indigo-600" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">{automation.label}</h3>
            <p className="text-xs text-slate-400">{automation.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
          <span className="text-xs font-medium text-slate-600">{statusLabel}</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-6 text-xs text-slate-400 mb-4 pb-4 border-b border-slate-100">
        <span>Last run: <strong className="text-slate-600">{timeAgo(apiRow?.last_run)}</strong></span>
        <span>30-day runs: <strong className="text-slate-600">{apiRow?.total_runs_30d ?? 0}</strong></span>
        <span>Success rate: <strong className="text-slate-600">{apiRow?.success_rate ?? 0}%</strong></span>
        <span>Avg duration: <strong className="text-slate-600">
          {apiRow?.avg_duration_ms ? `${(apiRow.avg_duration_ms / 1000).toFixed(1)}s` : '—'}
        </strong></span>
      </div>

      {/* Recent outcome */}
      {apiRow?.last_outcome && (
        <div className="flex items-center gap-2 mb-4 text-xs">
          <span className="text-slate-400">Last outcome:</span>
          <StatusBadge status={apiRow.last_status} />
          <span className="text-slate-600">{apiRow.last_outcome}</span>
        </div>
      )}

      {/* Detail link */}
      <Link
        to={`/automations/${automation.workflow_id}`}
        className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
      >
        View run history <ArrowRight size={12} />
      </Link>
    </div>
  );
}

export default function Automations() {
  const config = useClientConfig();
  const { data, loading, error } = useApi('/automations');

  const apiByWorkflowId = {};
  if (data) data.forEach(row => { apiByWorkflowId[row.workflow_id] = row; });

  if (error) return <EmptyState icon="alert" title="Unable to load automations" description="Try refreshing the page." />;

  return (
    <div className="space-y-4 fade-in">
      {loading
        ? Array.from({ length: config.automations.length }).map((_, i) => <SkeletonCard key={i} lines={4} />)
        : config.automations.length === 0
          ? <EmptyState icon="inbox" title="No automations configured" description="Automations will appear here once added to your configuration." />
          : config.automations.map(automation => (
              <AutomationRow
                key={automation.id}
                automation={automation}
                apiRow={apiByWorkflowId[automation.workflow_id]}
              />
            ))
      }
    </div>
  );
}
