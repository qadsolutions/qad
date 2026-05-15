import { createContext, useContext, useEffect, useState } from 'react';

const ClientConfigContext = createContext(null);

export function ClientConfigProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const clientId = new URLSearchParams(window.location.search).get('client_id') || 'acme_corp';
    fetch(`/api/config?client_id=${clientId}`)
      .then(r => r.json())
      .then(data => { setConfig(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-[#F8F9FB]">
      <div className="text-[#94A3B8] text-sm">Loading portal…</div>
    </div>
  );

  if (!config) return (
    <div className="flex items-center justify-center min-h-screen bg-[#F8F9FB]">
      <div className="text-[#F43F5E] text-sm">Failed to load client configuration.</div>
    </div>
  );

  return (
    <ClientConfigContext.Provider value={config}>
      {children}
    </ClientConfigContext.Provider>
  );
}

export function useClientConfig() {
  return useContext(ClientConfigContext);
}

// Helper: check if a section is enabled
export function useFeature(section) {
  const config = useClientConfig();
  return config?.features_enabled?.includes(section) ?? false;
}

// Helper: get automation by id
export function useAutomation(id) {
  const config = useClientConfig();
  return config?.automations?.find(a => a.id === id) ?? null;
}
