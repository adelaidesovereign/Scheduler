export type Lean = "day" | "night" | "any";
export type ShiftName = "day" | "night" | "all";

export interface Staff {
  id: string;
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
  staffPerShift: number;
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
