export interface Rule {
  id: number;
  text: string;
}

export interface RuleCategory {
  title: string;
  rules: Rule[];
}

// The firm's 40 trading rules — grouped for readability. IDs are stable
// across categories (1-40) so checked-state keys never shift if the grouping
// or wording changes.
export const PLAYBOOK: RuleCategory[] = [
  {
    title: "Journal & Metrics",
    rules: [
      { id: 1, text: "Journal every trade" },
      { id: 2, text: "Track your win rate" },
      { id: 3, text: "Track your average win" },
      { id: 4, text: "Track your average loss" },
      { id: 5, text: "Did you follow the plan? Yes or no" },
      { id: 6, text: "Grade the quality of the setup" },
      { id: 7, text: "Log your emotional state on entry" },
      { id: 8, text: "Note the time of the trade" },
      { id: 9, text: "Review the journal every Sunday" },
      { id: 10, text: "Backtest 100 setups on a weekend" },
    ],
  },
  {
    title: "Preparation & Chart Reading",
    rules: [
      { id: 11, text: "Mark where price is forming first" },
      { id: 12, text: "Mark every level one by one" },
      { id: 13, text: "Read the chart right to left" },
      { id: 14, text: "Only take A+ setups" },
      { id: 15, text: "Wait for the double retest" },
      { id: 16, text: "Keep the news tab next to the chart" },
      { id: 17, text: "Do a mental-state check" },
      { id: 18, text: "Know the VWAP first" },
    ],
  },
  {
    title: "Risk & Execution",
    rules: [
      { id: 19, text: "Limit yourself to one or two trades a day" },
      { id: 20, text: "Set a max loss before opening the platform" },
      { id: 21, text: "Risk a fixed amount, not a feeling" },
      { id: 22, text: "Never move the stop loss" },
      { id: 23, text: "Close when the idea plays out" },
      { id: 24, text: "Stop after two losses" },
      { id: 25, text: "Reduce risk on Sundays" },
      { id: 26, text: "Don't chase extended candles" },
      { id: 27, text: "Ignore the candle colors" },
      { id: 28, text: "Avoid entries at tops and bottoms" },
    ],
  },
  {
    title: "Mindset & Discipline",
    rules: [
      { id: 29, text: "Celebrate the small wins" },
      { id: 30, text: "Accept losses as a cost of the business" },
      { id: 31, text: "Never revenge trade" },
      { id: 32, text: "Skip the days you can't focus" },
      { id: 33, text: "Think monthly, not daily" },
      { id: 34, text: "Grade your discipline, not your P&L" },
      { id: 35, text: "Get comfortable being bored" },
    ],
  },
  {
    title: "Business",
    rules: [
      { id: 36, text: "Save money for taxes" },
      { id: 37, text: "Pay yourself first" },
      { id: 38, text: "Treat your account like a business" },
      { id: 39, text: "Be the trader you want to become" },
      { id: 40, text: "Trade with a community" },
    ],
  },
];

export const TOTAL_RULES = PLAYBOOK.reduce((n, cat) => n + cat.rules.length, 0);

const STORAGE_KEY = "axe-playbook-checked";

export function loadChecked(): Set<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((n): n is number => typeof n === "number")) : new Set();
  } catch {
    return new Set();
  }
}

export function saveChecked(checked: Set<number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...checked]));
  } catch { /* storage unavailable */ }
}
