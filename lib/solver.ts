import { Config, Solution, SolveResult, Staff } from "./types";

export const DAYS = 7;
export const SHIFTS = 2; // 0 = day, 1 = night

interface Bounds {
  minShifts: number;
  maxShifts: number;
  prefShifts: number;
}

function shiftBounds(staff: Staff[], shiftHours: number): Bounds[] {
  return staff.map((s) => ({
    minShifts: Math.ceil(s.min / shiftHours),
    maxShifts: Math.floor(s.max / shiftHours),
    prefShifts: Math.round(s.pref / shiftHours),
  }));
}

function totalNeeded(cfg: Config): number {
  let t = 0;
  for (let d = 0; d < DAYS; d++) for (let s = 0; s < SHIFTS; s++) t += cfg.coverage[d][s];
  return t;
}

function validate(cfg: Config): string[] {
  const problems: string[] = [];
  const ids = cfg.staff.map((s) => s.id);
  if (new Set(ids).size !== ids.length) {
    problems.push("Two staff share the same initials. Each id must be unique.");
  }
  for (let d = 0; d < DAYS; d++) for (let s = 0; s < SHIFTS; s++) {
    if (cfg.coverage[d][s] > cfg.staff.length) {
      problems.push("A shift asks for more staff than the roster has.");
    }
  }
  const needed = totalNeeded(cfg);
  const b = shiftBounds(cfg.staff, cfg.shiftLengthHours);
  const maxAvail = b.reduce((a, x) => a + x.maxShifts, 0);
  const minForced = b.reduce((a, x) => a + x.minShifts, 0);
  if (maxAvail < needed) {
    problems.push(
      `Not enough capacity. The floor needs ${needed} shifts filled this week, but the roster maxes out at ${maxAvail}. Raise a maximum or add staff.`
    );
  }
  if (minForced > needed) {
    problems.push(
      `Minimum hours are too high. They force ${minForced} shifts but only ${needed} exist. Lower a minimum.`
    );
  }
  b.forEach((x, i) => {
    if (x.minShifts > x.maxShifts) {
      problems.push(`${ids[i]} has a minimum above their maximum. Fix their hours.`);
    }
  });
  return problems;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function leanScore(staff: Staff, s: number): number {
  if (staff.lean === "any") return 1;
  if (staff.lean === "day") return s === 0 ? 0 : 2;
  if (staff.lean === "night") return s === 1 ? 0 : 2;
  return 1;
}

function solveOnce(cfg: Config, bounds: Bounds[], rand: () => number): Solution | null {
  const n = cfg.staff.length;
  const assign: boolean[][][] = Array.from({ length: n }, () =>
    Array.from({ length: DAYS }, () => [false, false])
  );
  const shiftsOf = new Array(n).fill(0);
  const dayUsed: boolean[][] = Array.from({ length: n }, () => new Array(DAYS).fill(false));

  const off = new Set(cfg.timeOff.map((t) => `${t.id}|${t.day}|${t.shift}`));
  const idIndex: Record<string, number> = {};
  cfg.staff.forEach((s, i) => (idIndex[s.id] = i));

  const blocked = (e: number, d: number, s: number): boolean => {
    const sn = s === 0 ? "day" : "night";
    return off.has(`${cfg.staff[e].id}|${d}|${sn}`) || off.has(`${cfg.staff[e].id}|${d}|all`);
  };

  for (const l of cfg.locked) {
    const e = idIndex[l.id];
    if (e == null) continue;
    const s = l.shift === "day" ? 0 : 1;
    if (!assign[e][l.day][s]) {
      assign[e][l.day][s] = true;
      dayUsed[e][l.day] = true;
      shiftsOf[e]++;
    }
  }

  const eligible = (e: number, d: number, s: number): boolean => {
    if (dayUsed[e][d]) return false;
    if (shiftsOf[e] >= bounds[e].maxShifts) return false;
    if (blocked(e, d, s)) return false;
    if (s === 0 && d > 0 && assign[e][d - 1][1]) return false;
    return true;
  };

  for (let d = 0; d < DAYS; d++) {
    for (let s = 0; s < SHIFTS; s++) {
      let have = 0;
      for (let e = 0; e < n; e++) if (assign[e][d][s]) have++;
      const need = cfg.coverage[d][s] - have;
      if (need <= 0) continue;

      const pool: number[] = [];
      for (let e = 0; e < n; e++) {
        if (assign[e][d][s]) continue;
        if (!eligible(e, d, s)) continue;
        pool.push(e);
      }
      if (pool.length < need) return null;

      pool.sort((a, bb) => {
        const da = shiftsOf[a] - bounds[a].minShifts;
        const db = shiftsOf[bb] - bounds[bb].minShifts;
        if (da !== db) return da - db;
        const la = leanScore(cfg.staff[a], s);
        const lb = leanScore(cfg.staff[bb], s);
        if (la !== lb) return la - lb;
        return rand() - 0.5;
      });

      for (let k = 0; k < need; k++) {
        const e = pool[k];
        assign[e][d][s] = true;
        dayUsed[e][d] = true;
        shiftsOf[e]++;
      }
    }
  }

  const recompute = (e: number, d: number) => assign[e][d][0] || assign[e][d][1];
  const eligibleForSwap = (e: number, d: number, s: number): boolean => {
    if (assign[e][d][0] || assign[e][d][1]) return false;
    if (shiftsOf[e] >= bounds[e].maxShifts) return false;
    if (blocked(e, d, s)) return false;
    if (s === 0 && d > 0 && assign[e][d - 1][1]) return false;
    if (s === 1 && d < DAYS - 1 && assign[e][d + 1][0]) return false;
    return true;
  };

  for (let pass = 0; pass < 40; pass++) {
    let changed = false;
    for (let e = 0; e < n; e++) {
      if (shiftsOf[e] >= bounds[e].minShifts) continue;
      let done = false;
      for (let d = 0; d < DAYS && !done && shiftsOf[e] < bounds[e].minShifts; d++) {
        for (let s = 0; s < SHIFTS && !done; s++) {
          if (assign[e][d][s]) continue;
          if (!eligibleForSwap(e, d, s)) continue;
          for (let o = 0; o < n; o++) {
            if (!assign[o][d][s]) continue;
            if (shiftsOf[o] <= bounds[o].minShifts) continue;
            assign[o][d][s] = false;
            dayUsed[o][d] = recompute(o, d);
            shiftsOf[o]--;
            assign[e][d][s] = true;
            dayUsed[e][d] = true;
            shiftsOf[e]++;
            changed = true;
            done = true;
            break;
          }
        }
      }
    }
    if (!changed) break;
  }

  for (let e = 0; e < n; e++) {
    if (shiftsOf[e] < bounds[e].minShifts) return null;
    if (shiftsOf[e] > bounds[e].maxShifts) return null;
    for (let d = 0; d < DAYS - 1; d++) {
      if (assign[e][d][1] && assign[e][d + 1][0]) return null;
    }
  }
  return { assign, shiftsOf };
}

function score(cfg: Config, bounds: Bounds[], sol: Solution): number {
  const n = cfg.staff.length;
  const w = cfg.weights;
  const we = new Set(cfg.weekendDays);
  let hoursDev = 0;
  let disliked = 0;
  const nights = new Array(n).fill(0);
  const weekend = new Array(n).fill(0);
  for (let e = 0; e < n; e++) {
    hoursDev += Math.abs(sol.shiftsOf[e] - bounds[e].prefShifts);
    for (let d = 0; d < DAYS; d++) {
      for (let s = 0; s < SHIFTS; s++) {
        if (!sol.assign[e][d][s]) continue;
        if (s === 1) nights[e]++;
        if (we.has(d)) weekend[e]++;
        if (leanScore(cfg.staff[e], s) === 2) disliked++;
      }
    }
  }
  const spread = (arr: number[]) => Math.max(...arr) - Math.min(...arr);
  return (
    w.hours * hoursDev +
    w.night * spread(nights) +
    w.weekend * spread(weekend) +
    w.lean * disliked
  );
}

export function solve(cfg: Config, budgetMs = 250): SolveResult {
  const problems = validate(cfg);
  if (problems.length) return { status: "INVALID", problems };
  const bounds = shiftBounds(cfg.staff, cfg.shiftLengthHours);
  let best: Solution | null = null;
  let bestScore = Infinity;
  const start = Date.now();
  let attempts = 0;
  let feasible = 0;
  const rand = rng(cfg.seed || Math.floor(Math.random() * 1e9));
  while (Date.now() - start < budgetMs && attempts < 6000) {
    attempts++;
    const sol = solveOnce(cfg, bounds, rand);
    if (!sol) continue;
    feasible++;
    const sc = score(cfg, bounds, sol);
    if (sc < bestScore) {
      bestScore = sc;
      best = sol;
    }
  }
  if (!best) {
    return {
      status: "INFEASIBLE",
      problems: [
        "No schedule satisfies every hard rule as written. Most often this means too many requests land on the same slot, or minimum hours cannot all be met at once. Relax one request and generate again.",
      ],
    };
  }
  return { status: "OK", sol: best, score: bestScore, attempts, feasible };
}

export function summarize(cfg: Config, sol: Solution) {
  const n = cfg.staff.length;
  const we = new Set(cfg.weekendDays);
  const hours: Record<string, number> = {};
  const nights: Record<string, number> = {};
  const weekends: Record<string, number> = {};
  for (let e = 0; e < n; e++) {
    const id = cfg.staff[e].id;
    hours[id] = sol.shiftsOf[e] * cfg.shiftLengthHours;
    let nc = 0;
    let wc = 0;
    for (let d = 0; d < DAYS; d++) {
      for (let s = 0; s < SHIFTS; s++) {
        if (!sol.assign[e][d][s]) continue;
        if (s === 1) nc++;
        if (we.has(d)) wc++;
      }
    }
    nights[id] = nc;
    weekends[id] = wc;
  }
  return { hours, nights, weekends };
}
