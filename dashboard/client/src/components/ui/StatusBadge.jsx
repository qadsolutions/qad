const STATUS_MAP = {
  hot:           { bg: '#ECFDF5', text: '#065F46', label: 'Hot' },
  warm:          { bg: '#FFF7ED', text: '#9A3412', label: 'Warm' },
  cold:          { bg: '#F1F5F9', text: '#475569', label: 'Cold' },
  disqualified:  { bg: '#FFF1F2', text: '#9F1239', label: 'Disqualified' },
  rejected:      { bg: '#FFF1F2', text: '#9F1239', label: 'Rejected' },
  confirmed:     { bg: '#ECFDF5', text: '#065F46', label: 'Confirmed' },
  rescheduled:   { bg: '#EFF6FF', text: '#1E40AF', label: 'Rescheduled' },
  cancelled:     { bg: '#F1F5F9', text: '#475569', label: 'Cancelled' },
  pending_review:{ bg: '#FFFBEB', text: '#92400E', label: 'Pending Review' },
  pending:       { bg: '#FFFBEB', text: '#92400E', label: 'Pending' },
  success:       { bg: '#ECFDF5', text: '#065F46', label: 'Success' },
  auto_process:  { bg: '#ECFDF5', text: '#065F46', label: 'Auto Processed' },
  human_review:  { bg: '#FFFBEB', text: '#92400E', label: 'Human Review' },
  failure:       { bg: '#FFF1F2', text: '#9F1239', label: 'Failed' },
  error:         { bg: '#FFF1F2', text: '#9F1239', label: 'Error' },
  partial:       { bg: '#EFF6FF', text: '#1E40AF', label: 'Partial' },
  active:        { bg: '#ECFDF5', text: '#065F46', label: 'Active' },
  paused:        { bg: '#F1F5F9', text: '#475569', label: 'Paused' },
  invoice:       { bg: '#EFF6FF', text: '#1E40AF', label: 'Invoice' },
  contract:      { bg: '#F5F3FF', text: '#4C1D95', label: 'Contract' },
  referral:      { bg: '#ECFDF5', text: '#065F46', label: 'Referral' },
};

export default function StatusBadge({ status, label }) {
  const key = (status || '').toLowerCase().replace(/\s+/g, '_');
  const style = STATUS_MAP[key] || { bg: '#F1F5F9', text: '#475569', label: status || 'Unknown' };
  return (
    <span
      style={{ backgroundColor: style.bg, color: style.text }}
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap"
    >
      {label || style.label}
    </span>
  );
}
