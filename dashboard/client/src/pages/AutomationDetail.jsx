import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useApi } from '../hooks/useApi';
import StatusBadge from '../components/ui/StatusBadge';
import EmptyState from '../components/ui/EmptyState';
import { SkeletonCard } from '../components/ui/Skeleton';

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = (Date.now() - new Date(ts)) / 1000;
  if (diff < 60)   return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function AutomationDetail() {
  const { workflowId } = useParams();
  const { data, loading, error } = useApi(`/automations/${workflowId}`);

  if (loading) return <SkeletonCard lines={6} />;
  if (error)   return <EmptyState icon="alert" title="Unable to load automation" description={error} />;
  if (!data)   return null;

  const { summary, runs, daily } = data;

  return (
    <div className="space-y-6 fade-in">
      <Link to="/automations" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 transition-colors w-fit">
        <ArrowLeft size={14} /> Back to automations
      </Link>

      {/* Summary header */}
      <div className="bg-white rounded-[10px] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <h2 className="text-lg font-semibold text-slate-900 mb-1">{summary.workflow_name}</h2>
        <p className="text-sm text-slate-400 mb-4">ID: {summary.workflow_id}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Runs', value: summary.total_runs },
            { label: 'Successes', value: summary.successes },
            { label: 'Failures', value: summary.failures },
            { label: 'Success Rate', value: `${summary.success_rate}%` },
          ].map(({ label, value }) => (
            <div key={label}>
              <div className="text-xl font-bold text-slate-900">{value}</div>
              <div className="text-xs text-slate-400 uppercase tracking-wide mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 30-day chart */}
      {daily?.length > 0 && (
        <div className="bg-white rounded-[10px] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-slate-400 mb-4">30-Day Success Rate</h3>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={daily}>
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94A3B8' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94A3B8' }} unit="%" width={36} />
              <Tooltip formatter={v => [`${v}%`, 'Success rate']} />
              <Line type="monotone" dataKey="success_rate" stroke="#6366F1" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Run history table */}
      <div className="bg-white rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-slate-400">Run History</h3>
        </div>
        {runs?.length === 0 ? (
          <EmptyState icon="activity" title="No runs yet" description="Run history will appear here after the first execution." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Started', 'Duration', 'Status', 'Source', 'Outcome'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {runs.map(run => (
                  <tr key={run.execution_id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-xs text-slate-600">{timeAgo(run.started_at)}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">{run.duration_s ? `${run.duration_s}s` : '—'}</td>
                    <td className="px-5 py-3"><StatusBadge status={run.run_status} /></td>
                    <td className="px-5 py-3 text-xs text-slate-600">{run.source_type || '—'}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">{run.business_outcome || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
