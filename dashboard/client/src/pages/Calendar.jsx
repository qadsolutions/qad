import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import StatusBadge from '../components/ui/StatusBadge';
import DetailDrawer from '../components/ui/DetailDrawer';
import EmptyState from '../components/ui/EmptyState';
import { SkeletonCard } from '../components/ui/Skeleton';

export default function Calendar() {
  const [selected, setSelected] = useState(null);
  const { data, loading, error } = useApi('/calendar');

  const upcoming = data?.filter(a => new Date(a.appointment_time) >= new Date()) || [];
  const past = data?.filter(a => new Date(a.appointment_time) < new Date()) || [];

  return (
    <div className="space-y-6 fade-in">
      {loading ? <SkeletonCard lines={5} /> :
       error ? <EmptyState icon="alert" title="Unable to load calendar" description="Try refreshing." /> :
       <>
        {/* Upcoming */}
        <div>
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-slate-400 mb-3">Upcoming</h2>
          {!upcoming.length ? (
            <EmptyState icon="calendar" title="No upcoming appointments" description="Confirmed appointments will appear here." />
          ) : (
            <div className="bg-white rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] divide-y divide-slate-50">
              {upcoming.map(appt => (
                <div
                  key={appt.appointment_id}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors cursor-pointer"
                  onClick={() => setSelected(appt)}
                >
                  <div className="w-12 text-center shrink-0">
                    <div className="text-xs font-semibold text-indigo-600 uppercase">
                      {new Date(appt.appointment_time).toLocaleDateString('en-US', { month: 'short' })}
                    </div>
                    <div className="text-xl font-bold text-slate-900">
                      {new Date(appt.appointment_time).getDate()}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800">{appt.contact_name}</div>
                    <div className="text-xs text-slate-400">
                      {appt.service_type} · {new Date(appt.appointment_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: appt.timezone || undefined })}
                    </div>
                  </div>
                  <StatusBadge status={appt.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Past */}
        {past.length > 0 && (
          <div>
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-slate-400 mb-3">Past</h2>
            <div className="bg-white rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] divide-y divide-slate-50">
              {past.slice(0, 10).map(appt => (
                <div
                  key={appt.appointment_id}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors cursor-pointer opacity-60"
                  onClick={() => setSelected(appt)}
                >
                  <div className="w-12 text-center shrink-0">
                    <div className="text-xs font-semibold text-slate-400 uppercase">
                      {new Date(appt.appointment_time).toLocaleDateString('en-US', { month: 'short' })}
                    </div>
                    <div className="text-xl font-bold text-slate-500">
                      {new Date(appt.appointment_time).getDate()}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-700">{appt.contact_name}</div>
                    <div className="text-xs text-slate-400">{appt.service_type}</div>
                  </div>
                  <StatusBadge status={appt.status} />
                </div>
              ))}
            </div>
          </div>
        )}
       </>}

      {/* Detail drawer */}
      <DetailDrawer open={!!selected} onClose={() => setSelected(null)} title="Appointment Details">
        {selected && (
          <div className="space-y-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Contact</div>
              <div className="text-sm font-medium text-slate-800">{selected.contact_name}</div>
              <div className="text-sm text-slate-500">{selected.contact_email}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Appointment</div>
              <div className="text-sm text-slate-700">{selected.service_type}</div>
              <div className="text-sm text-slate-500">{new Date(selected.appointment_time).toLocaleString('en-US', { timeZone: selected.timezone || undefined, dateStyle: 'medium', timeStyle: 'short' })}{selected.timezone ? ` (${selected.timezone.replace('America/', '')})` : ''}</div>
            </div>
            <div className="flex gap-2">
              <StatusBadge status={selected.status} />
              {selected.auto_confirmed && <StatusBadge status="auto_confirmed" label="Auto-confirmed" />}
            </div>
            {selected.reminder_sequence?.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Reminders</div>
                <div className="space-y-1">
                  {selected.reminder_sequence.map((r, i) => (
                    <div key={i} className="text-xs text-slate-600">{JSON.stringify(r)}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
