import { useEffect, useState, useCallback } from 'react';
import { useClientConfig } from '../context/ClientConfigContext';

export function useApi(path, params = {}) {
  const config = useClientConfig();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const clientId = config?.client_id || 'acme_corp';

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ client_id: clientId, ...params }).toString();
    fetch(`/api${path}?${qs}`)
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [path, clientId, JSON.stringify(params)]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, refetch: load };
}
