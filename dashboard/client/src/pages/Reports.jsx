import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useApi } from '../hooks/useApi';
import { useClientConfig } from '../context/ClientConfigContext';
import EmptyState from '../components/ui/EmptyState';
import { SkeletonKPI } from '../components/ui/Skeleton';


const METRIC_LABELS = {
  total_leads:        'Total Leads',
  total_documents:    'Total Documents',
  total_appointments: 'Total Appointments',
  avg_score:          'Avg Score',
  auto_process_rate:  'Auto-Process Rate',
  auto_confirm_rate:  'Auto-Confirm Rate',
};

function SummaryCard({ value, label, sub }) {
  return (
    <div className="bg-white rounded-[10px] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="font-display text-3xl font-bold text-slate-900 mb-1">{value ?? '—'}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-6">
      <h3 className="text-[13px] font-semibold uppercase tracking-wider text-slate-400 mb-5">{title}</h3>
      {children}
    </div>
  );
}

function MetricStat({ metric, aData }) {
  let value = null;
  if (metric.startsWith('total_')) {
    value = aData?.total ?? 0;
  } else if (metric === 'avg_score') {
    value = aData?.avg_score ?? null;
  } else if (metric === 'auto_process_rate' || metric === 'auto_confirm_rate') {
    const raw = aData?.[metric];
    value = raw != null ? `${raw}%` : '—';
  }
  return (
    <div className="text-center">
      <div className="text-2xl font-bold text-slate-900">{value ?? '—'}</div>
      <div className="text-xs text-slate-400 mt-0.5">{METRIC_LABELS[metric] || metric}</div>
    </div>
  );
}

function BreakdownChart({ breakdown }) {
  if (!breakdown?.length) return null;
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, breakdown.length * 28)}>
      <BarChart data={breakdown} layout="vertical" margin={{ left: 8, right: 8 }}>
        <XAxis type="number" tick={{ fontSize: 11, fill: '#94A3B8' }} width={30} />
        <YAxis type="category" dataKey="status" tick={{ fontSize: 11, fill: '#94A3B8' }} width={120} />
        <Tooltip />
        <Bar dataKey="count" fill="#6366F1" radius={[0,4,4,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function AutomationReportSection({ automation, aData }) {
  const metrics = automation.report_metrics || [];
  const scalarMetrics = metrics.filter(m => !m.includes('breakdown'));
  const breakdownMetric = metrics.find(m => m.includes('breakdown'));

  return (
    <Section title={automation.label}>
      {scalarMetrics.length > 0 && (
        <div className={`grid grid-cols-2 md:grid-cols-${Math.min(scalarMetrics.length, 4)} gap-4 mb-6`}>
          {scalarMetrics.map(m => (
            <MetricStat key={m} metric={m} aData={aData} />
          ))}
        </div>
      )}
      {breakdownMetric && (
        <BreakdownChart breakdown={aData?.breakdown} />
      )}
    </Section>
  );
}

export default function Reports() {
  const config = useClientConfig();
  const [range, setRange] = useState('30');
  const { data, loading, error } = useApi('/reports', { range });

  const reportAutomations = config.automations.filter(a =>
    (a.nav_sections || []).includes('reports')
  );

  if (error) return <EmptyState icon="alert" title="Unable to load reports" description="Try refreshing." />;

  return (
    <div className="space-y-6 fade-in">
      {/* Date range selector */}
      <div className="flex items-center gap-2">
        {[['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days']].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setRange(v)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${range === v ? 'bg-indigo-50 text-indigo-700' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? Array.from({length:3}).map((_,i)=><SkeletonKPI key={i} />) : <>
          <SummaryCard value={data?.summary?.total_runs?.toLocaleString()} label="Total Runs" sub={`${range}-day window`} />
          <SummaryCard value={`${data?.summary?.success_rate ?? 0}%`} label="Success Rate" />
          <SummaryCard value={data?.summary?.total_failures?.toLocaleString()} label="Failures" />
        </>}
      </div>

      {/* Daily trend chart */}
      {!loading && data?.daily?.length > 0 && (
        <Section title="Daily Volume">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.daily}>
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94A3B8' }} tickFormatter={d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
              <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} width={30} />
              <Tooltip />
              <Bar dataKey="success_count" name="Success" stackId="a" fill="#10B981" radius={[0,0,0,0]} />
              <Bar dataKey="review_count"  name="Review"  stackId="a" fill="#F59E0B" />
              <Bar dataKey="failed_count"  name="Failed"  stackId="a" fill="#F43F5E" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
      )}

      {/* Per-automation report sections — driven entirely by config */}
      {!loading && reportAutomations.map(auto => (
        <AutomationReportSection
          key={auto.id}
          automation={auto}
          aData={data?.automations?.[auto.id]}
        />
      ))}
    </div>
  );
}
