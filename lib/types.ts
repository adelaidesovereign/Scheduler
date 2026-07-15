export type Lean = "day" | "night" | "any";
export type ShiftName = "day" | "night" | "all";

export interface Staff {
  id: string;
  name?: string; // full name, optional display
  pref: number; // preferred weekly hours
  min: number; // hard minimum weekly hours
  max: number; // hard maximum weekly hours
  lean: Lean;
}

export interface TimeOff {
  id: string;
  day: number; // 0 = week start
  shift: ShiftName;
}

export interface Locked {
  id: string;
  day: number;
  shift: "day" | "night";
}

export interface Weights {
  hours: number;
  night: number;
  weekend: number;
  lean: number;
}

export interface Config {
  staff: Staff[];
  dayStartHour: number;
  nightStartHour: number;
  shiftLengthHours: number;
  // How many staff must be on each slot: coverage[day][0]=day shift, coverage[day][1]=night shift.
  coverage: number[][];
  timeOff: TimeOff[];
  locked: Locked[];
  weights: Weights;
  weekendDays: number[];
  seed?: number;
}

export interface Solution {
  assign: boolean[][][]; // [employee][day][shift]
  shiftsOf: number[];
}

export type SolveResult =
  | { status: "INVALID"; problems: string[] }
  | { status: "INFEASIBLE"; problems: string[] }
  | { status: "OK"; sol: Solution; score: number; attempts: number; feasible: number };
