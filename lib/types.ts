export type Lean = "day" | "night" | "any";
export type ShiftName = "day" | "night" | "all";

export interface Staff {
  id: string;
  name?: string;
  pref: number; // preferred weekly hours
  min: number; // hard minimum weekly hours
  max: number; // hard maximum weekly hours
  lean: Lean;
}

// A block-level hold: person cannot work block b of day d.
export interface BlockOff {
  id: string;
  day: number;
  block: number; // 0: 8a-2p, 1: 2p-8p, 2: 8p-2a, 3: 2a-8a
}

export interface Weights {
  hours: number;
  night: number;
  weekend: number;
  lean: number;
  fragment: number; // lone half-shifts cost a little, full shifts preferred
}

export interface Config {
  staff: Staff[];
  blockOff: BlockOff[];
  weights: Weights;
  weekendDays: number[];
  seed?: number;
}

export interface Solution {
  assign: boolean[][][]; // [employee][day][block]
  blocksOf: number[];
}

export type SolveResult =
  | { status: "INVALID"; problems: string[] }
  | { status: "INFEASIBLE"; problems: string[] }
  | { status: "OK"; sol: Solution; score: number; attempts: number; feasible: number };
