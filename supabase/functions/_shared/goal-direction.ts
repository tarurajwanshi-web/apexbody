export type Direction = "lose" | "gain" | "maintain";

const RATE_CEILINGS: Record<string, number> = {
  fat_loss: 1.5,
  muscle_gain: 0.5,
  strength: 0.35,
};

export function goalDirection(goal: string): Direction {
  switch (goal) {
    case "fat_loss": return "lose";
    case "muscle_gain": return "gain";
    case "strength": return "gain";
    case "recomposition": return "maintain";
    case "athletic_performance": return "maintain";
    default:
      throw new Error(`goalDirection: unrecognized goal value "${goal}" — refusing to guess a direction`);
  }
}

export function rateCeilingFor(goal: string): number | null {
  return RATE_CEILINGS[goal] ?? null;
}
