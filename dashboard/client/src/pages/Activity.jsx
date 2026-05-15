import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useClientConfig } from '../context/ClientConfigContext';
import StatusBadge from '../components/ui/StatusBadge';
import EmptyState from '../components/ui/EmptyState';
import { SkeletonCard } from '../components/ui/Skeleton';

const AUTOMATION_LABELS = {
  customer_intake: 'Intake',
  document_intake: 'Documents',
  appointment_scheduling: 'Appointments',
};

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = (Date.now() - new Date(ts)) / 1000;
  if (diff < 60)   return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Activity() {
  const config = useClientConfig();
  const [automationFilter, setAutomationFilter] = useState('');
  const { data, loading, error } = useApi('/activity', { limit: 100, ...(automationFilter ? { automation: automationFilter } : {}) });

  // Group by date
  const grouped = {};
  if (data) {
    data.forEach(item => {
      const day = new Date(item.activity_time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      if (!grouped[day]) grouped[day] = [];
      grouped[day].push(item);
    });
  }

  return (
    <div className="space-y-6 fade-in">
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setAutomationFilter('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${!automationFilter ? 'bg-indigo-50 text-indigo-700' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
        >
          All
        </button>
        {config.automations.map(a => (
          <button
            key={a.id}
            onClick={() => setAutomationFilter(automationFilter === a.db_table.replace('_log', '') ? '' : a.db_table.replace('_log', ''))}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${automationFilter === a.db_table.replace('_log','') ? 'bg-indigo-50 text-indigo-700' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {loading ? <SkeletonCard lines={6} /> :
       error ? <EmptyState icon="alert" title="Unable to load activity" description="Try refreshing the page." /> :
       !data?.length ? (
        <EmptyState icon="activity" title="No activity yet" description="Events will appear here once automations start running." />
       ) : (
        Object.entries(grouped).map(([day, items]) => (
          <div key={day}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3">{day}</div>
            <div className="bg-white rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] divide-y divide-slate-50">
              {items.map((item, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">
                      {item.contact_email || item.service_type || item.record_id}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-400">{AUTOMATION_LABELS[item.automation] || item.automation}</span>
                      <span className="text-xs text-slate-300">·</span>
                      <span className="text-xs text-slate-400">{item.source_type || '—'}</span>
                      <span className="text-xs text-slate-300">·</span>
                      <span className="text-xs text-slate-400">{timeAgo(item.activity_time)}</span>
                    </div>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
              ))}
            </div>
          </div>
        ))
       )}
    </div>
  );
}
