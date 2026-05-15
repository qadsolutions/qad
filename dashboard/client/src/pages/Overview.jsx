import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Minus, Clock, CheckCircle, AlertTriangle, Activity } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useClientConfig } from '../context/ClientConfigContext';
import StatusBadge from '../components/ui/StatusBadge';
import Sparkline from '../components/ui/Sparkline';
import EmptyState from '../components/ui/EmptyState';
import { SkeletonKPI, SkeletonCard } from '../components/ui/Skeleton';

const WORKFLOW_ID_MAP = {
  customer_intake_v1:         'intake',
  document_intake_v1:         'documents',
  appointment_scheduling_v1:  'appointments',
};

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = (Date.now() - new Date(ts)) / 1000;
  if (diff < 60)   return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function KPICard({ value, label, trend, color }) {
  const borderColors = {
    indigo: 'border-l-indigo-500',
    emerald: 'border-l-emerald-500',
    sky: 'border-l-sky-500',
    rose: 'border-l-rose-500',
    amber: 'border-l-amber-500',
  };
  return (
    <div className={`bg-white rounded-[10px] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] border-l-4 ${borderColors[color] || borderColors.indigo} fade-in`}>
      <div className="font-display text-3xl font-bold text-slate-900 mb-1">{value ?? '—'}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">{label}</div>
      {trend !== undefined && (
        <div className="flex items-center gap-1 text-xs text-slate-400">
          {trend > 0 ? <TrendingUp size={12} className="text-emerald-500" /> :
           trend < 0 ? <TrendingDown size={12} className="text-rose-500" /> :
           <Minus size={12} />}
          <span>Last 30 days</span>
        </div>
      )}
    </div>
  );
}

function AutomationHealthCard({ automation, healthRow, sparkData }) {
  const isActive = healthRow?.last_status === 'success' || healthRow?.last_status === 'partial';
  const status = !healthRow ? 'No data' : isActive ? 'Active' : 'Degraded';
  const statusColor = !healthRow ? 'text-slate-400' : isActive ? 'text-emerald-600' : 'text-amber-600';
  const dotColor = !healthRow ? 'bg-slate-400' : isActive ? 'bg-emerald-500' : 'bg-amber-500';

  return (
    <div className="bg-white rounded-[10px] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)] hover:shadow-[0_4px_6px_rgba(0,0,0,0.07)] transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-[15px] font-semibold text-slate-800">{automation.label}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{automation.description}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
          <span className={`text-xs font-medium ${statusColor}`}>{status}</span>
        </div>
      </div>

      <Sparkline data={sparkData} dataKey="success_rate" color="#6366F1" />

      <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
        <span>Last run: {timeAgo(healthRow?.last_run)}</span>
        <span>·</span>
        <span>{healthRow?.total_runs ?? 0} runs (7d)</span>
        <span>·</span>
        <span className="text-slate-600 font-medium">{healthRow?.success_rate ?? 0}% success</span>
      </div>
    </div>
  );
}

function ActivityRow({ item }) {
  const AUTOMATION_LABELS = {
    customer_intake:   'Intake',
    document_intake:   'Documents',
    appointment_scheduling: 'Appointments',
  };
  const label = AUTOMATION_LABELS[item.automation] || item.automation;

  return (
    <div className="flex items-center gap-4 py-3 border-b border-slate-100 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700 truncate">
            {item.contact_email || item.service_type || item.record_id}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-slate-400">{label}</span>
          <span className="text-[11px] text-slate-300">·</span>
          <span className="text-[11px] text-slate-400">{timeAgo(item.activity_time)}</span>
        </div>
      </div>
      <StatusBadge status={item.status} />
    </div>
  );
}

export default function Overview() {
  const config = useClientConfig();
  const { data, loading, error } = useApi('/overview');

  // Map sparkline data per workflow_id
  const sparkByWorkflow = {};
  if (data?.sparklines) {
    data.sparklines.forEach(row => {
      if (!sparkByWorkflow[row.workflow_id]) sparkByWorkflow[row.workflow_id] = [];
      sparkByWorkflow[row.workflow_id].push(row);
    });
  }

  // Map health rows per workflow_id
  const healthByWorkflow = {};
  if (data?.health) {
    data.health.forEach(row => { healthByWorkflow[row.workflow_id] = row; });
  }

  if (error) return (
    <EmptyState icon="alert" title="Unable to load overview" description="This may be a temporary issue. Try refreshing the page." />
  );

  return (
    <div className="space-y-6 fade-in">
      {/* Greeting */}
      <div>
        <h2 className="text-xl font-semibold text-slate-900">
          Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {config.client_name}
        </h2>
        <p className="text-sm text-slate-400 mt-0.5">Here is your automation summary.</p>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonKPI key={i} />)
        ) : (
          <>
            <KPICard value={data?.kpis?.total_runs?.toLocaleString()} label="Total Runs (30d)" color="indigo" />
            <KPICard value={`${data?.kpis?.success_rate ?? 0}%`} label="Success Rate" color="emerald" />
            <KPICard value={data?.kpis?.runs_today?.toLocaleString()} label="Runs Today" color="sky" />
            <KPICard
              value={data?.kpis?.open_exceptions}
              label="Open Exceptions"
              color={data?.kpis?.open_exceptions > 0 ? 'amber' : 'emerald'}
            />
          </>
        )}
      </div>

      {/* Two-column: Automation Health + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Automation Health (3/5) */}
        <div className="lg:col-span-3 space-y-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-slate-400">Automation Health</h2>
          {loading ? (
            Array.from({ length: config.automations.length }).map((_, i) => <SkeletonCard key={i} />)
          ) : config.automations.length === 0 ? (
            <EmptyState icon="check" title="No automations configured" description="Add automations to your client config to see health cards." />
          ) : (
            config.automations.map(automation => (
              <AutomationHealthCard
                key={automation.id}
                automation={automation}
                healthRow={healthByWorkflow[automation.workflow_id]}
                sparkData={sparkByWorkflow[automation.workflow_id] || []}
              />
            ))
          )}
        </div>

        {/* Recent Activity (2/5) */}
        <div className="lg:col-span-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-slate-400 mb-4">Recent Activity</h2>
          <div className="bg-white rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] px-5 py-2">
            {loading ? (
              <SkeletonCard lines={5} />
            ) : !data?.activity?.length ? (
              <EmptyState icon="activity" title="No activity yet" description="Events will appear here once automations start running." />
            ) : (
              <>
                {data.activity.map((item, i) => <ActivityRow key={i} item={item} />)}
                <Link to="/activity" className="block text-center text-xs font-medium text-indigo-600 hover:text-indigo-700 py-3 transition-colors">
                  View full activity →
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Upcoming Appointments */}
      {config.features_enabled?.includes('calendar') && (
        <div>
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-slate-400 mb-4">Upcoming Appointments</h2>
          <div className="bg-white rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] divide-y divide-slate-100">
            {loading ? <SkeletonCard lines={3} /> :
             !data?.upcoming_appointments?.length ? (
              <EmptyState icon="calendar" title="No upcoming appointments" description="Confirmed appointments will appear here." />
            ) : (
              data.upcoming_appointments.map(appt => (
                <div key={appt.appointment_id} className="flex items-center gap-4 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800">{appt.contact_name}</div>
                    <div className="text-xs text-slate-400">{appt.service_type} · {new Date(appt.appointment_time).toLocaleString()}</div>
                  </div>
                  <StatusBadge status={appt.status} />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
