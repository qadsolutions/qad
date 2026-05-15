import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';

export default function Sparkline({ data = [], dataKey = 'success_rate', color = '#6366F1' }) {
  if (!data.length) return <div className="h-[60px] bg-slate-50 rounded" />;
  return (
    <ResponsiveContainer width="100%" height={60}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.15} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Tooltip
          contentStyle={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid #E2E8F0' }}
          formatter={v => [`${v}%`, 'Success']}
          labelFormatter={() => ''}
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          fill={`url(#spark-${dataKey})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
