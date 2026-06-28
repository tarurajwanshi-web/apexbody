import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { getTDEETrend } from "@/lib/coach.functions";
import { T } from "./tokens";

export function TDEETrendChart() {
  const fn = useServerFn(getTDEETrend);
  const { data } = useSuspenseQuery({
    queryKey: ["coach", "tdeeTrend"],
    queryFn: () => fn(),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 2,
  });

  if (!data?.weeks?.length) {
    return (
      <div
        style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 12, padding: 16, fontSize: 13, color: T.text3,
        }}
      >
        Track your nutrition to see TDEE trends.
      </div>
    );
  }

  const lineColor =
    data.trendDirection === "positive" ? T.green :
    data.trendDirection === "negative" ? T.red : T.amber;

  const chartData = data.weeks.map((w) => ({
    week: new Date(w.weekStartDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    tdee: w.blendedTDEE,
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
          <LineChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke={T.border} strokeDasharray="2 3" vertical={false} />
            <XAxis dataKey="week" tick={{ fill: T.text3, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fill: T.text3, fontSize: 10 }}
              axisLine={false} tickLine={false}
              domain={["dataMin - 100", "dataMax + 100"]}
              tickFormatter={(v) => (typeof v === "number" ? v.toFixed(0) : v)}
            />
            <Tooltip
              contentStyle={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: T.text3 }}
              formatter={(v: number) => (typeof v === "number" ? `${v.toFixed(0)} kcal` : v)}
            />
            <Line type="monotone" dataKey="tdee" stroke={lineColor} strokeWidth={2} dot={{ r: 3, fill: lineColor }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: T.text2 }}>
        {data.annotation}
      </div>
    </div>
  );
}
