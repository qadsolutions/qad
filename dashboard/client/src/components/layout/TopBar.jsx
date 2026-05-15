import { useLocation } from 'react-router-dom';
import { Bell, User } from 'lucide-react';
import { useClientConfig } from '../../context/ClientConfigContext';

const TITLES = {
  '/':             'Overview',
  '/automations':  'Automations',
  '/activity':     'Activity',
  '/documents':    'Documents',
  '/tasks':        'Tasks & Follow-Ups',
  '/calendar':     'Calendar',
  '/exceptions':   'Exceptions & Reviews',
  '/reports':      'Reports & Outcomes',
  '/settings':     'Settings',
};

export default function TopBar({ exceptionCount = 0 }) {
  const location = useLocation();
  const config = useClientConfig();
  const basePath = '/' + location.pathname.split('/')[1];
  const title = TITLES[basePath] || 'QAD Portal';

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <header className="fixed top-0 left-60 right-0 h-16 bg-white border-b border-slate-200 flex items-center px-8 z-20">
      <div className="flex-1">
        <h1 className="text-[17px] font-semibold text-slate-900">{title}</h1>
        <p className="text-xs text-slate-400">{dateStr}</p>
      </div>
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <button
          className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 transition-colors cursor-pointer"
          aria-label="Notifications"
        >
          <Bell size={18} />
          {exceptionCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full" />
          )}
        </button>
        {/* Avatar */}
        <button
          className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          aria-label="User menu"
        >
          <div className="w-7 h-7 bg-indigo-100 rounded-full flex items-center justify-center">
            <User size={14} className="text-indigo-600" />
          </div>
          <span className="text-sm font-medium text-slate-700">{config.client_name}</span>
        </button>
      </div>
    </header>
  );
}
