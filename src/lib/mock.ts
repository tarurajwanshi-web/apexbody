export const todayMetrics = {
  apexScore: 74,
  recovery: 68,
  sleep: 72,
  strain: 55,
  hrv: 81,
  rhr: 58,
  sleepHours: 7.2,
};

export const weekDays = [
  { day: "Mon", state: "done" },
  { day: "Tue", state: "done" },
  { day: "Wed", state: "rest" },
  { day: "Thu", state: "today" },
  { day: "Fri", state: "future" },
  { day: "Sat", state: "future" },
  { day: "Sun", state: "rest" },
] as const;

export const todaySession = {
  name: "Upper Body Push",
  duration: 60,
  intensity: "High",
  exercises: [
    { name: "Bench Press", sets: 4, reps: "8-10", weight: "85-90kg", aiNote: "Aim for 88kg based on your 1RM" },
    { name: "Overhead Press", sets: 3, reps: "8", weight: "55kg" },
    { name: "Incline Dumbbell Press", sets: 3, reps: "10-12", weight: "30kg" },
    { name: "Lateral Raises", sets: 3, reps: "12-15", weight: "10kg" },
    { name: "Tricep Pushdown", sets: 3, reps: "12", weight: "35kg" },
    { name: "Cable Fly", sets: 3, reps: "12-15", weight: "20kg" },
  ],
};

export const todayMeals = [
  { type: "Breakfast", time: "8:30am", items: "Oats, whey, blueberries", kcal: 540, p: 42, c: 68, f: 12 },
  { type: "Lunch", time: "1:15pm", items: "Chicken, rice, broccoli, avocado", kcal: 720, p: 58, c: 72, f: 22 },
  { type: "Snack", time: "4:00pm", items: "Greek yogurt, almonds", kcal: 280, p: 22, c: 14, f: 14 },
  { type: "Dinner", time: "7:45pm", items: "Salmon, sweet potato, salad", kcal: 620, p: 48, c: 52, f: 24 },
];

export const macroTargets = { kcal: 2400, p: 220, c: 200, f: 65 };
export const macroToday = { kcal: 1840, p: 178, c: 162, f: 52 };

export const aiInsightRotation = [
  "HRV up 12% — your body is ready. Push intensity today.",
  "Recovery dropped 8%. I'm lowering volume on your next session.",
  "You're 42g short on protein. Add a snack before 8pm.",
  "Three strong sessions this week. Volume is trending up 9%.",
  "Sleep debt rising. Aim for 8h tonight to protect tomorrow's lift.",
];

export const chips = [
  "I only have 30 min",
  "I slept badly",
  "Shoulder feels tight",
  "I'm feeling great",
  "I missed last session",
];
