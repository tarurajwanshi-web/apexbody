import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings/body-composition")({
  head: () => ({ meta: [{ title: "Body composition — APEX" }] }),
  component: BodyCompositionPage,
});

type Sex = "male" | "female";

const BF_RANGE = {
  female: { min: 10, max: 50, default: 28 },
  male:   { min: 5,  max: 40, default: 20 },
} as const;

function BfDescriptor({ pct, sex }: { pct: number; sex: Sex }) {
  const brackets = sex === "male"
    ? [
        { max: 8,  label: "Very lean" },
        { max: 13, label: "Athletic" },
        { max: 17, label: "Fit" },
        { max: 24, label: "Average" },
        { max: 30, label: "Soft" },
        { max: 40, label: "Very high" },
      ]
    : [
        { max: 13, label: "Very lean" },
        { max: 20, label: "Athletic" },
        { max: 24, label: "Fit" },
        { max: 31, label: "Average" },
        { max: 38, label: "Soft" },
        { max: 50, label: "Very high" },
      ];
  const b = brackets.find((x) => pct <= x.max) ?? brackets[brackets.length - 1];
  return <span>{b.label}</span>;
}

function BodyCompositionPage() {
  const router = useRouter();
  const [sex, setSex] = useState<Sex>("male");
  const [bf, setBf] = useState<string>("");
  const [lean, setLean] = useState<string>("");
  const [waist, setWaist] = useState<string>("");
  const [hip, setHip] = useState<string>("");
  const [arm, setArm] = useState<string>("");
  const [thigh, setThigh] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("profiles")
        .select("biological_sex, dexa_body_fat_pct, dexa_lean_mass_kg, measurement_waist_cm, measurement_hip_cm")
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (!data) return;
      if (data.biological_sex === "male" || data.biological_sex === "female") setSex(data.biological_sex);
      if (data.dexa_body_fat_pct != null) setBf(String(data.dexa_body_fat_pct));
      if (data.dexa_lean_mass_kg != null) setLean(String(data.dexa_lean_mass_kg));
      if (data.measurement_waist_cm != null) setWaist(String(data.measurement_waist_cm));
      if (data.measurement_hip_cm != null) setHip(String(data.measurement_hip_cm));
    })();
  }, []);

  const range = BF_RANGE[sex];
  const bfNum = bf === "" ? range.default : Number(bf);

  const save = async () => {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const bodyDataType: "dexa" | "measurements" | null =
        lean !== "" ? "dexa" : (waist !== "" || hip !== "") ? "measurements" : null;
      const payload = {
        user_id: u.user.id,
        dexa_body_fat_pct: bf === "" ? null : Number(bf),
        dexa_lean_mass_kg: lean === "" ? null : Number(lean),
        measurement_waist_cm: waist === "" ? null : Number(waist),
        measurement_hip_cm: hip === "" ? null : Number(hip),
        body_data_type: bodyDataType,
      };
      const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
      toast.success("Saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen pb-40" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)" }}>
      <header className="flex items-center justify-between px-5">
        <button onClick={() => router.history.back()} className="text-text-secondary" aria-label="Back">
          <ChevronLeft size={24} />
        </button>
        <span className="text-label text-text-tertiary">Precision</span>
        <span className="w-6" />
      </header>

      <main className="px-5 mt-8 max-w-[480px] mx-auto">
        <h1 className="text-hero text-text-primary">Body composition</h1>
        <p className="mt-3 text-body text-text-secondary">
          Optional — add these to sharpen your calorie targets. Otherwise we adapt from your weekly weight trend.
        </p>

        {/* Body fat estimate */}
        <section className="mt-8 rounded-[22px] p-5" style={{ background: "var(--bg-1)", border: "1px solid var(--border-hairline)" }}>
          <p className="text-label text-text-tertiary text-center">Body fat estimate</p>
          {bf !== "" ? (
            <>
              <p className="text-center mt-3 text-text-primary" style={{ fontSize: 44, fontWeight: 300, fontVariantNumeric: "tabular-nums" }}>
                {bfNum}%
              </p>
              <p className="text-center text-body-sm text-text-secondary mt-1">
                <BfDescriptor pct={bfNum} sex={sex} />
              </p>
            </>
          ) : (
            <p className="text-center mt-3 text-body-sm text-text-tertiary">Drag to estimate — leave blank to skip.</p>
          )}
          <input
            type="range"
            min={range.min}
            max={range.max}
            step={1}
            value={bfNum}
            onChange={(e) => setBf(e.target.value)}
            className="w-full mt-4"
            style={{ accentColor: "var(--amber-500)" }}
          />
          {bf !== "" && (
            <button type="button" onClick={() => setBf("")} className="mt-3 w-full text-body-sm text-text-tertiary underline underline-offset-2">
              Clear
            </button>
          )}
          <p className="mt-3 text-body-sm text-text-tertiary text-center">Sex: {sex}. Based on ACE classifications.</p>
        </section>

        {/* DEXA / InBody */}
        <section className="mt-4 rounded-[22px] p-5" style={{ background: "var(--bg-1)", border: "1px solid var(--border-hairline)" }}>
          <p className="text-label text-text-tertiary">DEXA / InBody</p>
          <p className="mt-2 text-body-sm text-text-secondary">
            If you have a scan, enter the numbers here. Improves BMR accuracy.
          </p>
          <label className="mt-4 flex items-center justify-between rounded-[14px] px-4 py-3" style={{ background: "var(--bg-2)", border: "1px solid var(--border-hairline)" }}>
            <span className="text-body-sm text-text-secondary">Lean mass</span>
            <span className="flex items-center gap-1">
              <input
                type="text" inputMode="decimal"
                value={lean}
                onChange={(e) => setLean(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="—"
                className="w-24 bg-transparent text-right text-body focus:outline-none"
              />
              <span className="text-body-sm text-text-tertiary">kg</span>
            </span>
          </label>
        </section>

        {/* Tape measurements */}
        <section className="mt-4 rounded-[22px] p-5" style={{ background: "var(--bg-1)", border: "1px solid var(--border-hairline)" }}>
          <p className="text-label text-text-tertiary">Tape measurements</p>
          <div className="mt-3 space-y-2">
            {[
              { label: "Waist", value: waist, set: setWaist },
              { label: "Hip", value: hip, set: setHip },
              { label: "Arm", value: arm, set: setArm },
              { label: "Thigh", value: thigh, set: setThigh },
            ].map((row) => (
              <label key={row.label} className="flex items-center justify-between rounded-[14px] px-4 py-3" style={{ background: "var(--bg-2)", border: "1px solid var(--border-hairline)" }}>
                <span className="text-body-sm text-text-secondary">{row.label}</span>
                <span className="flex items-center gap-1">
                  <input
                    type="text" inputMode="decimal"
                    value={row.value}
                    onChange={(e) => row.set(e.target.value.replace(/[^\d.]/g, ""))}
                    placeholder="—"
                    className="w-24 bg-transparent text-right text-body focus:outline-none"
                  />
                  <span className="text-body-sm text-text-tertiary">cm</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <button
          onClick={save}
          disabled={saving}
          className="mt-6 w-full rounded-[14px] py-3.5 text-body font-medium disabled:opacity-40"
          style={{
            background: "linear-gradient(135deg, var(--amber-500) 0%, var(--amber-300) 100%)",
            color: "#0A0B12",
            boxShadow: "var(--shadow-inset-top)",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </main>
    </div>
  );
}
