import { useEffect, useState, useCallback } from "react";

export type Profile = {
  name: string;
  gender: "male" | "female" | "other" | null;
  age: number;
  weightKg: number;
  heightCm: number;
  weightUnit: "kg" | "lbs";
  heightUnit: "cm" | "ft";
  goal: "recomp" | "fatloss" | "strength" | "performance" | null;
  experience: "beginner" | "intermediate" | "advanced" | null;
  frequency: number;
  days: string[];
  bodyFat: number;
  targetBodyFat: number;
  photos: { front?: string; side?: string; back?: string };
  recoveryDevice: "whoop" | "screenshots" | "apple" | "manual" | null;
  coachName: string;
  onboarded: boolean;
  agreedTerms: boolean;
  streak: number;
};

export const DEFAULT_PROFILE: Profile = {
  name: "",
  gender: null,
  age: 28,
  weightKg: 78,
  heightCm: 177,
  weightUnit: "kg",
  heightUnit: "cm",
  goal: null,
  experience: null,
  frequency: 4,
  days: ["Mon", "Tue", "Thu", "Fri"],
  bodyFat: 18,
  targetBodyFat: 13,
  photos: {},
  recoveryDevice: null,
  coachName: "APEX",
  onboarded: false,
  agreedTerms: false,
  streak: 12,
};


const KEY = "apex_user_profile";

export function loadProfile(): Profile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PROFILE;
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveProfile(p: Profile) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setProfile(loadProfile());
    setHydrated(true);
  }, []);

  const update = useCallback((patch: Partial<Profile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...patch };
      saveProfile(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    saveProfile(DEFAULT_PROFILE);
    setProfile(DEFAULT_PROFILE);
  }, []);

  return { profile, update, reset, hydrated };
}
