export type Side = "day" | "night" | "any";

export interface Staff {
  id: string;
  name?: string;
  pref: number; // preferred weekly hours
  min: number; // hard minimum weekly hours
  max: number; // hard maximum weekly hours
  side: Side;          // night-only staff never touch days, and the reverse
  anchor: boolean;     // may lead a day shift; every day hour needs one anchor on
  primary: boolean;    // scheduled first, protected toward their target
  maxStretchBlocks: number; // longest continuous stretch, in 4h blocks (2 = 8h, 3 = 12h)
}

export interface BlockOff {
  id: string;
  day: number;
  block: number; // 0:8a-12p 1:12p-4p 2:4p-8p 3:8p-12a 4:12a-4a 5:4a-8a
}

export interface Weights {
  hours: number;
  night: number;
  weekend: number;
  fragment: number;
  crowd: number; // keeping day shifts lean, fewest people that the hours allow
}

export interface Config {
  staff: Staff[];
  blockOff: BlockOff[];
  weights: Weights;
  weekendDays: number[];
  carryNights?: number[];   // nights already worked earlier in the period, for fairness
  carryWeekends?: number[]; // weekend days already worked earlier in the period
  dayLabels?: string[];     // display names for days, used in problem messages
  seed?: number;
}

export interface Solution {
  assign: boolean[][][];
  blocksOf: number[];
}

export type SolveResult =
  | { status: "INVALID"; problems: string[] }
  | { status: "INFEASIBLE"; problems: string[] }
  | { status: "OK"; sol: Solution; score: number; attempts: number; feasible: number };
