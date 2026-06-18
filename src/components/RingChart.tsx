type Ring = { value: number; color: string; label?: string };

export function RingChart({ rings, size = 96, stroke = 7, centerLabel }: {
  rings: Ring[];
  size?: number;
  stroke?: number;
  centerLabel?: string;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const gap = 3;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
      {rings.map((r, i) => {
        const radius = cx - stroke / 2 - i * (stroke + gap);
        const c = 2 * Math.PI * radius;
        const dash = (r.value / 100) * c;
        return (
          <g key={i} transform={`rotate(-90 ${cx} ${cy})`}>
            <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={r.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${c}`}
              strokeLinecap="round"
              style={{ transition: "stroke-dasharray 0.8s ease-out" }}
            />
          </g>
        );
      })}
      {centerLabel && (
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="fill-text-primary font-bold" style={{ fontSize: size * 0.22, fontFamily: "var(--font-display)" }}>
          {centerLabel}
        </text>
      )}
    </svg>
  );
}

export function Sparkline({ values, color = "#A78BFA", width = 100, height = 30 }: { values: number[]; color?: string; width?: number; height?: number }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${i * step},${height - ((v - min) / range) * height}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
