import { NavLink } from 'react-router-dom';
import { useClientConfig, useFeature } from '../../context/ClientConfigContext';
import {
  LayoutDashboard, Zap, Activity, FileText, CheckSquare,
  Calendar, AlertTriangle, BarChart2, Settings
} from 'lucide-react';

const ALL_NAV = [
  { id: 'overview',    label: 'Overview',    icon: LayoutDashboard, path: '/' },
  { id: 'automations', label: 'Automations', icon: Zap,             path: '/automations' },
  { id: 'activity',    label: 'Activity',    icon: Activity,        path: '/activity' },
  { id: 'documents',   label: 'Documents',   icon: FileText,        path: '/documents' },
  { id: 'tasks',       label: 'Tasks',       icon: CheckSquare,     path: '/tasks' },
  { id: 'calendar',    label: 'Calendar',    icon: Calendar,        path: '/calendar' },
  { id: 'exceptions',  label: 'Exceptions',  icon: AlertTriangle,   path: '/exceptions' },
  { id: 'reports',     label: 'Reports',     icon: BarChart2,       path: '/reports' },
  { id: 'settings',    label: 'Settings',    icon: Settings,        path: '/settings' },
];

function NavItem({ item, badge }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer relative
         ${isActive
          ? 'bg-indigo-500/12 text-indigo-400'
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-indigo-500 rounded-r-full" />
          )}
          <Icon size={18} />
          <span>{item.label}</span>
          {badge > 0 && (
            <span className="ml-auto bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar({ exceptionCount = 0 }) {
  const config = useClientConfig();

  // Only show nav items that are in features_enabled
  const visibleNav = ALL_NAV.filter(item =>
    item.id === 'overview' || config.features_enabled?.includes(item.id)
  );

  return (
    <aside className="fixed left-0 top-0 h-full w-60 bg-slate-950 flex flex-col z-30">
      {/* Logo / Client name */}
      <div className="h-16 flex items-center px-5 border-b border-slate-800">
        {config.logo_url ? (
          <img src={config.logo_url} alt={config.client_name} className="max-h-8 max-w-[140px] object-contain" />
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-indigo-500 rounded-lg flex items-center justify-center">
              <Zap size={14} className="text-white" />
            </div>
            <span className="font-display font-semibold text-white text-[15px] truncate">
              {config.client_name}
            </span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
        {visibleNav.map(item => (
          <NavItem
            key={item.id}
            item={item}
            badge={item.id === 'exceptions' ? exceptionCount : 0}
          />
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-800">
        <p className="text-[10px] text-slate-600 uppercase tracking-widest">QAD Platform</p>
      </div>
    </aside>
  );
}
