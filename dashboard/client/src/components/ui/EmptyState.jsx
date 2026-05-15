import { FileX, CheckCircle, Calendar, AlertTriangle, Activity, Inbox } from 'lucide-react';

const ICONS = {
  check: CheckCircle,
  file: FileX,
  calendar: Calendar,
  alert: AlertTriangle,
  activity: Activity,
  inbox: Inbox,
};

export default function EmptyState({ icon = 'inbox', title, description, action }) {
  const Icon = ICONS[icon] || Inbox;
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center fade-in">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <Icon size={28} className="text-slate-400" />
      </div>
      <h3 className="text-[15px] font-semibold text-slate-700 mb-1">{title}</h3>
      {description && <p className="text-sm text-slate-400 max-w-xs leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
