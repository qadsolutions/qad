import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ClientConfigProvider, useClientConfig } from './context/ClientConfigContext';
import { useApi } from './hooks/useApi';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import PageWrapper from './components/layout/PageWrapper';

import Overview         from './pages/Overview';
import Automations      from './pages/Automations';
import AutomationDetail from './pages/AutomationDetail';
import Activity         from './pages/Activity';
import Documents        from './pages/Documents';
import Tasks            from './pages/Tasks';
import Calendar         from './pages/Calendar';
import Exceptions       from './pages/Exceptions';
import Reports          from './pages/Reports';
import Settings         from './pages/Settings';

function DashboardShell() {
  const config = useClientConfig();
  const { data: overviewData } = useApi('/overview');
  const exceptionCount = overviewData?.kpis?.open_exceptions || 0;

  const feat = section => config.features_enabled?.includes(section);

  return (
    <BrowserRouter>
      <Sidebar exceptionCount={exceptionCount} />
      <TopBar exceptionCount={exceptionCount} />
      <PageWrapper>
        <Routes>
          <Route path="/"                        element={<Overview />} />
          <Route path="/automations"             element={feat('automations') ? <Automations />      : <Navigate to="/" />} />
          <Route path="/automations/:workflowId" element={feat('automations') ? <AutomationDetail /> : <Navigate to="/" />} />
          <Route path="/activity"                element={feat('activity')    ? <Activity />         : <Navigate to="/" />} />
          <Route path="/documents"               element={feat('documents')   ? <Documents />        : <Navigate to="/" />} />
          <Route path="/tasks"                   element={feat('tasks')       ? <Tasks />            : <Navigate to="/" />} />
          <Route path="/calendar"                element={feat('calendar')    ? <Calendar />         : <Navigate to="/" />} />
          <Route path="/exceptions"              element={feat('exceptions')  ? <Exceptions />       : <Navigate to="/" />} />
          <Route path="/reports"                 element={feat('reports')     ? <Reports />          : <Navigate to="/" />} />
          <Route path="/settings"                element={feat('settings')    ? <Settings />         : <Navigate to="/" />} />
          <Route path="*"                        element={<Navigate to="/" />} />
        </Routes>
      </PageWrapper>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <ClientConfigProvider>
      <DashboardShell />
    </ClientConfigProvider>
  );
}
