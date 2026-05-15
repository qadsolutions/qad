import { useClientConfig } from '../context/ClientConfigContext';

export default function Settings() {
  const config = useClientConfig();
  return (
    <div className="max-w-xl space-y-6 fade-in">
      <div className="bg-white rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-6">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-slate-400 mb-4">Client Profile</h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Client ID</span>
            <span className="font-mono text-slate-700">{config.client_id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Client Name</span>
            <span className="text-slate-700">{config.client_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Active Automations</span>
            <span className="text-slate-700">{config.automations.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Primary Color</span>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full border border-slate-200" style={{ backgroundColor: config.primary_color }} />
              <span className="font-mono text-slate-700">{config.primary_color}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-6">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-slate-400 mb-4">Automations</h3>
        <div className="space-y-3">
          {config.automations.map(a => (
            <div key={a.id} className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-slate-800">{a.label}</div>
                <div className="text-xs text-slate-400">{a.description}</div>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                Active
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
