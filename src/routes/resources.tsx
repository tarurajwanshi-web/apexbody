import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, FileText, Download, Loader2, BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { toast } from "sonner";

export const Route = createFileRoute("/resources")({
  head: () => ({ meta: [{ title: "Resources — APEX" }] }),
  component: ResourcesPage,
});

type ResourceFile = { name: string; size?: number; updated_at?: string | null };

function ResourcesPage() {
  const [files, setFiles] = useState<ResourceFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.storage.from("resources").list("", {
        limit: 100,
        sortBy: { column: "updated_at", order: "desc" },
      });
      if (error) toast.error(error.message);
      setFiles((data ?? []).filter((f) => f.name && !f.name.endsWith("/")));
      setLoading(false);
    })();
  }, []);

  const open = async (name: string) => {
    const { data, error } = await supabase.storage.from("resources").createSignedUrl(name, 300);
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "Could not get link");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  return (
    <div className="min-h-screen bg-bg-1 pb-32">
      <header className="flex items-center justify-between px-5 pt-6">
        <Link to="/dashboard" className="text-text-secondary">
          <ChevronLeft size={24} />
        </Link>
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Library</span>
        <span className="w-6" />
      </header>

      <div className="px-5 mt-3 flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl gradient-brand flex items-center justify-center">
          <BookOpen size={18} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Resources</h1>
          <p className="text-[12px] text-text-tertiary">Guides, ebooks, and references from APEX.</p>
        </div>
      </div>

      <section className="mx-5 mt-6 rounded-2xl bg-bg-2 border border-white/5 divide-y divide-white/5">
        {loading ? (
          <div className="px-4 py-8 flex justify-center">
            <Loader2 size={18} className="animate-spin text-text-tertiary" />
          </div>
        ) : files.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-text-tertiary text-center">
            No resources available yet. Check back soon.
          </p>
        ) : (
          files.map((f) => (
            <button
              key={f.name}
              onClick={() => open(f.name)}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:opacity-70 transition"
            >
              <FileText size={18} className="text-text-tertiary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{f.name.replace(/^\d+-/, "")}</p>
                {f.size != null && (
                  <p className="text-[10px] text-text-tertiary">{(f.size / 1024).toFixed(0)} KB</p>
                )}
              </div>
              <Download size={16} className="text-text-tertiary shrink-0" />
            </button>
          ))
        )}
      </section>

      <BottomNav />
    </div>
  );
}
