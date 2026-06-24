import { T } from "@/components/dashboard/tokens";

type Props = {
  points: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  strokeWidth?: number;
};

/**
 * Tiny inline-SVG sparkline. Null points create gaps. If all values are null,
 * renders a flat hairline so the slot keeps its shape (no layout shift).
 */
export function Sparkline({
  points,
  width = 80,
  height = 24,
  color = T.green,
  fill = true,
  strokeWidth = 1.5,
}: Props) {
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const nums = points.filter((p): p is number => typeof p === "number" && Number.isFinite(p));
  const empty = nums.length === 0;

  if (empty) {
    return (
      <svg width={width} height={height} aria-hidden style={{ display: "block" }}>
        <line
          x1={pad}
          x2={width - pad}
          y1={height / 2}
          y2={height / 2}
          stroke={T.border}
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const stepX = points.length > 1 ? w / (points.length - 1) : 0;

  // Build segments — break the path on nulls.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p == null || !Number.isFinite(p)) {
      if (current.length) segments.push(current.join(" "));
      current = [];
      return;
    }
    const x = pad + i * stepX;
    const y = pad + h - ((p - min) / range) * h;
    current.push(`${current.length === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
  });
  if (current.length) segments.push(current.join(" "));

  // Area fill — only for the longest contiguous segment to avoid weird unions.
  const firstX = pad;
  const lastX = pad + (points.length - 1) * stepX;
  const stroke = segments.join(" ");
  const area = fill && segments.length === 1
    ? `${stroke} L ${lastX.toFixed(1)} ${height - pad} L ${firstX.toFixed(1)} ${height - pad} Z`
    : null;

  const gid = `sl-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg width={width} height={height} aria-hidden style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {area && <path d={area} fill={`url(#${gid})`} />}
      <path d={stroke} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 7-day boolean bar grid for things like consistency (logged vs not).
 */
export function BarGrid({
  values,
  width = 80,
  height = 24,
  color = T.green,
}: { values: boolean[]; width?: number; height?: number; color?: string }) {
  const gap = 2;
  const bw = (width - gap * (values.length - 1)) / values.length;
  return (
    <svg width={width} height={height} aria-hidden style={{ display: "block" }}>
      {values.map((v, i) => (
        <rect
          key={i}
          x={i * (bw + gap)}
          y={v ? 2 : height / 2 - 1}
          width={bw}
          height={v ? height - 4 : 2}
          rx={1}
          fill={v ? color : T.border}
        />
      ))}
    </svg>
  );
}
