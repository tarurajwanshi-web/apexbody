import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { getWeightTrend } from "@/lib/coach.functions";
import { T } from "./tokens";

export function WeightTrendChart() {
  const fn = useServerFn(getWeightTrend);
  const { data } = useSuspenseQuery({
    queryKey: ["coach", "weightTrend"],
    queryFn: () => fn(),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 2,
  });

  if (!data?.smoothedTrend?.length) {
    return (
      <div
        style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 12, padding: 16, fontSize: 13, color: T.text3,
        }}
      >
        Log weight measurements to see trends.
      </div>
    );
  }

  const rawMap = new Map(data.rawWeight.map((r) => [r.date, r.weight]));
  const chartData = data.smoothedTrend.map((t) => ({
    date: t.date.slice(5),
    smoothed: t.weight,
    raw: rawMap.get(t.date) ?? null,
  }));

  return (
    <div
      style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 12, padding: 14,
      }}
    >
      <div style={{ width: "100%", height: 180 }}>
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke={T.border} strokeDasharray="2 3" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: T.text3, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fill: T.text3, fontSize: 10 }}
              axisLine={false} tickLine={false}
              domain={["dataMin - 0.5", "dataMax + 0.5"]}
              tickFormatter={(v) => (typeof v === "number" ? v.toFixed(1) : v)}
            />
            <Tooltip
              contentStyle={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: T.text3 }}
              formatter={(v: number) => (typeof v === "number" ? `${v.toFixed(1)} kg` : v)}
            />
            <Line type="monotone" dataKey="raw" stroke={T.text3} strokeWidth={1} dot={false} strokeDasharray="3 3" connectNulls />
            <Line type="monotone" dataKey="smoothed" stroke={T.primary} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: T.text2, textAlign: "right" }}>
        {data.trendArrow}
      </div>
    </div>
  );
}
