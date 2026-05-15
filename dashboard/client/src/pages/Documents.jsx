import { useState, useRef, useCallback } from 'react';
import { FileText, Eye, Upload, X, CheckCircle, AlertTriangle, Loader } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useClientConfig } from '../context/ClientConfigContext';
import StatusBadge from '../components/ui/StatusBadge';
import EmptyState from '../components/ui/EmptyState';
import DetailDrawer from '../components/ui/DetailDrawer';
import { SkeletonCard } from '../components/ui/Skeleton';

const FILE_COLORS = {
  pdf:  'text-rose-500 bg-rose-50',
  docx: 'text-sky-500 bg-sky-50',
  xlsx: 'text-emerald-500 bg-emerald-50',
  txt:  'text-slate-500 bg-slate-50',
};

const ACCEPTED = '.pdf,.docx,.txt,.xlsx,.csv,.tiff,.png,.jpg';

function ConfidenceBar({ score }) {
  const pct = Math.round((score || 0) * 100);
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500 w-8">{pct}%</span>
    </div>
  );
}

function DocumentDrawer({ doc, onClose }) {
  if (!doc) return null;
  const fields = doc.extracted_fields || {};
  return (
    <DetailDrawer open={!!doc} onClose={onClose} title={doc.file_name}>
      <div className="space-y-5">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={doc.processing_status} />
          <StatusBadge status={doc.classification_label} />
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Confidence</div>
          <ConfidenceBar score={doc.confidence_score} />
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Routing</div>
          <p className="text-sm text-slate-700">{doc.routing_destination || doc.downstream_action || '—'}</p>
        </div>

        {Object.keys(fields).length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Extracted Fields</div>
            <div className="space-y-2">
              {Object.entries(fields).map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm gap-4">
                  <span className="text-slate-500 capitalize shrink-0">{k.replace(/_/g, ' ')}</span>
                  <span className="text-slate-800 font-medium text-right truncate">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Details</div>
          <div className="space-y-1 text-sm text-slate-600">
            <div>Document ID: <span className="font-mono text-xs">{doc.document_id}</span></div>
            <div>Type: {doc.file_type?.toUpperCase()}</div>
            <div>Source: {doc.source_type}</div>
            <div>Processed: {doc.processed_at ? new Date(doc.processed_at).toLocaleString() : '—'}</div>
          </div>
        </div>
      </div>
    </DetailDrawer>
  );
}

// ─── Upload modal ────────────────────────────────────────────────

function UploadModal({ open, onClose, clientId, onSuccess }) {
  const [file, setFile] = useState(null);
  const [sender, setSender] = useState('');
  const [subject, setSubject] = useState('');
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | uploading | success | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const inputRef = useRef();

  const reset = () => { setFile(null); setSender(''); setSubject(''); setStatus('idle'); setResult(null); setErrorMsg(''); };
  const handleClose = () => { reset(); onClose(); };

  const pickFile = (f) => {
    if (!f) return;
    setFile(f);
    setStatus('idle');
    setResult(null);
    if (!subject) setSubject(`Upload: ${f.name}`);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) pickFile(f);
  }, [subject]);

  const onDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);

  const submit = async () => {
    if (!file) return;
    setStatus('uploading');
    setErrorMsg('');

    try {
      const ext = file.name.split('.').pop().toLowerCase();
      const isText = ['txt', 'csv', 'md', 'html'].includes(ext);
      let document_text = null;
      let file_content_base64 = null;

      if (isText) {
        document_text = await file.text();
      } else {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        bytes.forEach(b => { binary += String.fromCharCode(b); });
        file_content_base64 = btoa(binary);
      }

      const payload = {
        client_id: clientId || 'acme_corp',
        file_name: file.name,
        file_type: ext,
        file_size: file.size,
        sender: sender || undefined,
        subject: subject || `Upload: ${file.name}`,
        document_text,
        file_content_base64,
      };

      const resp = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();

      if (!resp.ok) {
        setErrorMsg(data.error || 'Upload failed');
        setStatus('error');
        return;
      }

      setResult(data);
      setStatus('success');
      onSuccess?.();
    } catch (e) {
      setErrorMsg(e.message || 'Unexpected error');
      setStatus('error');
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40 fade-in" onClick={handleClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Upload Document"
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[520px] bg-white rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.15)] z-50 fade-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Upload Document</h2>
          <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {status === 'success' ? (
            /* Success state */
            <div className="space-y-4">
              <div className="flex flex-col items-center py-4 text-center">
                <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mb-3">
                  <CheckCircle size={24} className="text-emerald-500" />
                </div>
                <p className="text-sm font-semibold text-slate-800 mb-0.5">Document submitted successfully</p>
                <p className="text-xs text-slate-400">{file?.name}</p>
              </div>

              {result && (
                <div className="bg-slate-50 rounded-xl p-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Classification</span>
                    <StatusBadge status={result.classification_label} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Status</span>
                    <StatusBadge status={result.processing_status} />
                  </div>
                  {result.confidence_score != null && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-500 shrink-0">Confidence</span>
                      <div className="flex-1"><ConfidenceBar score={result.confidence_score} /></div>
                    </div>
                  )}
                  {result.routing_destination && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Routed to</span>
                      <span className="text-slate-700 font-medium">{result.routing_destination}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={reset} className="flex-1 px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors cursor-pointer">
                  Upload another
                </button>
                <button onClick={handleClose} className="flex-1 px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer">
                  Done
                </button>
              </div>
            </div>
          ) : (
            /* Upload form */
            <>
              {/* Drop zone */}
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${dragging ? 'border-indigo-400 bg-indigo-50' : file ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onClick={() => inputRef.current?.click()}
              >
                <input ref={inputRef} type="file" accept={ACCEPTED} className="hidden" onChange={e => pickFile(e.target.files[0])} />
                {file ? (
                  <div className="flex flex-col items-center gap-1">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-1 ${FILE_COLORS[file.name.split('.').pop().toLowerCase()] || 'text-slate-400 bg-slate-50'}`}>
                      <FileText size={20} />
                    </div>
                    <p className="text-sm font-medium text-slate-700 truncate max-w-[300px]">{file.name}</p>
                    <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(0)} KB · Click to change</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center mb-2">
                      <Upload size={18} className="text-slate-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-600">Drop a file here, or click to browse</p>
                    <p className="text-xs text-slate-400 mt-0.5">PDF, DOCX, TXT, XLSX, CSV, images</p>
                  </div>
                )}
              </div>

              {/* Optional metadata */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Sender (optional)</label>
                  <input
                    type="email"
                    placeholder="sender@example.com"
                    value={sender}
                    onChange={e => setSender(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Subject / Description (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Invoice from Vendor, Patient referral"
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                  />
                </div>
              </div>

              {/* Error */}
              {status === 'error' && (
                <div className="flex items-center gap-2 text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-lg">
                  <AlertTriangle size={14} className="shrink-0" />
                  {errorMsg}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button onClick={handleClose} className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer">
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={!file || status === 'uploading'}
                  className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 ${!file || status === 'uploading' ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer'}`}
                >
                  {status === 'uploading' ? (
                    <><Loader size={14} className="animate-spin" /> Processing…</>
                  ) : 'Submit to Automation'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Main page ───────────────────────────────────────────────────

export default function Documents() {
  const config = useClientConfig();
  const [selected, setSelected] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const { data, loading, error, refetch } = useApi('/documents', { limit: 50 });

  return (
    <div className="fade-in">
      {/* Page header with upload button */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-sm text-slate-400">
            {loading ? 'Loading…' : `${data?.length ?? 0} document${data?.length !== 1 ? 's' : ''} processed`}
          </p>
        </div>
        <button
          onClick={() => setUploadOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer shadow-sm"
        >
          <Upload size={15} />
          Upload Document
        </button>
      </div>

      {/* Table */}
      {loading ? <SkeletonCard lines={5} /> :
       error ? <EmptyState icon="alert" title="Unable to load documents" description="Try refreshing the page." /> :
       !data?.length ? (
        <div className="flex flex-col items-center py-16 text-center">
          <EmptyState
            icon="file"
            title="No documents yet"
            description="Files submitted through the automation will appear here with classification and routing details."
            action={
              <button
                onClick={() => setUploadOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer"
              >
                <Upload size={14} />
                Upload your first document
              </button>
            }
          />
        </div>
       ) : (
        <div className="bg-white rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  {['File', 'Classification', 'Confidence', 'Status', 'Routing', 'Processed', ''].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.map(doc => (
                  <tr key={doc.document_id} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => setSelected(doc)}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded flex items-center justify-center shrink-0 ${FILE_COLORS[doc.file_type?.toLowerCase()] || 'text-slate-400 bg-slate-50'}`}>
                          <FileText size={14} />
                        </div>
                        <span className="text-slate-700 font-medium truncate max-w-[180px]">{doc.file_name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3"><StatusBadge status={doc.classification_label} /></td>
                    <td className="px-5 py-3 w-32"><ConfidenceBar score={doc.confidence_score} /></td>
                    <td className="px-5 py-3"><StatusBadge status={doc.processing_status} /></td>
                    <td className="px-5 py-3 text-xs text-slate-600">{doc.routing_destination || '—'}</td>
                    <td className="px-5 py-3 text-xs text-slate-400">{doc.processed_at ? new Date(doc.processed_at).toLocaleDateString() : '—'}</td>
                    <td className="px-5 py-3">
                      <Eye size={14} className="text-slate-300 hover:text-indigo-500 transition-colors" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
       )}

      <DocumentDrawer doc={selected} onClose={() => setSelected(null)} />

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        clientId={config?.client_id}
        onSuccess={() => { setUploadOpen(false); setTimeout(refetch, 1500); }}
      />
    </div>
  );
}
