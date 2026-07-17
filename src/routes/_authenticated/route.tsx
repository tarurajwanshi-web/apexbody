import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/" });

    // Onboarding gate — never let an incomplete profile reach a protected app screen.
    // Exempt the onboarding route itself so the user can actually complete it.
    const path = location.pathname;
    if (path.startsWith("/_authenticated/onboarding") || path === "/onboarding") {
      return { user: data.user };
    }

    const { data: prof } = await supabase
      .from("profiles")
      .select("profile_completed_at, disclaimer_accepted_at")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (!prof || !prof.profile_completed_at) {
      if (!prof || !prof.disclaimer_accepted_at) throw redirect({ to: "/disclaimer" });
      throw redirect({ to: "/onboarding" });
    }

    return { user: data.user };
  },
  component: () => <Outlet />,
});
