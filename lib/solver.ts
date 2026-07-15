import { Config, Solution, SolveResult, Staff } from "./types";

export const DAYS = 7;
export const BLOCKS = 4;           // 0: 8a-2p, 1: 2p-8p, 2: 8p-2a, 3: 2a-8a
export const BLOCK_HOURS = 6;
export const FLOOR = 2;            // at least two on the floor, every hour, always
export const MAX_BLOCKS_PER_DAY = 2;

// Valid same-day patterns: nothing, one half, or a full shift.
// Full day = blocks 0+1 (8a-8p). Full night = blocks 2+3 (8p-8a).
// No day half glued to a night half; that would be a 12h span across the pivot.
const PAIR: Record<number, number> = { 0: 1, 1: 0, 2: 3, 3: 2 };
const isDayBlock = (b: number) => b < 2;

interface Bounds { minBlocks: number; maxBlocks: number; prefBlocks: number; }

function bounds(staff: Staff[]): Bounds[] {
  return staff.map((s) => ({
    minBlocks: Math.ceil(s.min / BLOCK_HOURS),
    maxBlocks: Math.min(Math.floor(s.max / BLOCK_HOURS), DAYS * MAX_BLOCKS_PER_DAY),
    prefBlocks: Math.round(s.pref / BLOCK_HOURS),
  }));
}

function validate(cfg: Config): string[] {
  const problems: string[] = [];
  const ids = cfg.staff.map((s) => s.id);
  if (new Set(ids).size !== ids.length) {
    problems.push("Two staff share the same initials. Each id must be unique.");
  }
  const b = bounds(cfg.staff);
  b.forEach((x, i) => {
    if (x.minBlocks > x.maxBlocks) {
      problems.push(`${ids[i]} has minimum hours above what their maximum allows in a week.`);
    }
  });
  // The floor alone needs 2 people on all 28 block-slots = 336 hours.
  const floorBlocks = DAYS * BLOCKS * FLOOR;
  const maxAvail = b.reduce((a, x) => a + x.maxBlocks, 0);
  if (maxAvail < floorBlocks) {
    problems.push(
      `Keeping two on the floor all week takes ${floorBlocks * BLOCK_HOURS} staff-hours. ` +
      `The roster's maximums only allow ${maxAvail * BLOCK_HOURS}. Raise some Max hours or add staff.`
    );
  }
  return problems;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function leanScore(staff: Staff, b: number): number {
  if (staff.lean === "any") return 1;
  if (staff.lean === "day") return isDayBlock(b) ? 0 : 2;
  return isDayBlock(b) ? 2 : 0;
}

function solveOnce(cfg: Config, bnd: Bounds[], rand: () => number): Solution | null {
  const n = cfg.staff.length;
  const assign: boolean[][][] = Array.from({ length: n }, () =>
    Array.from({ length: DAYS }, () => new Array(BLOCKS).fill(false))
  );
  const blocksOf = new Array(n).fill(0);

  const off = new Set(cfg.blockOff.map((t) => `${t.id}|${t.day}|${t.block}`));
  const blocked = (e: number, d: number, b: number) => off.has(`${cfg.staff[e].id}|${d}|${b}`);

  const dayBlocks = (e: number, d: number) => {
    const out: number[] = [];
    for (let b = 0; b < BLOCKS; b++) if (assign[e][d][b]) out.push(b);
    return out;
  };

  const workedNight = (e: number, d: number) => d >= 0 && (assign[e][d][2] || assign[e][d][3]);

  // Can employee e take block b on day d given every hard rule?
  const eligible = (e: number, d: number, b: number): boolean => {
    if (assign[e][d][b]) return false;
    if (blocksOf[e] >= bnd[e].maxBlocks) return false;
    if (blocked(e, d, b)) return false;
    const cur = dayBlocks(e, d);
    if (cur.length >= MAX_BLOCKS_PER_DAY) return false;
    if (cur.length === 1 && cur[0] !== PAIR[b]) return false; // only clean pairs
    // Rest: night work on day d bans day blocks on day d+1, both directions.
    if (isDayBlock(b) && workedNight(e, d - 1)) return false;
    if (!isDayBlock(b) && d + 1 < DAYS && (assign[e][d + 1][0] || assign[e][d + 1][1])) return false;
    return true;
  };

  const place = (e: number, d: number, b: number) => { assign[e][d][b] = true; blocksOf[e]++; };
  const unplace = (e: number, d: number, b: number) => { assign[e][d][b] = false; blocksOf[e]--; };

  // Pass 1: hold the floor. Fill every block-slot to exactly two, chronologically.
  for (let d = 0; d < DAYS; d++) {
    for (let b = 0; b < BLOCKS; b++) {
      let have = 0;
      for (let e = 0; e < n; e++) if (assign[e][d][b]) have++;
      let need = FLOOR - have;
      if (need <= 0) continue;

      const pool: number[] = [];
      for (let e = 0; e < n; e++) if (eligible(e, d, b)) pool.push(e);
      if (pool.length < need) return null;

      pool.sort((a, z) => {
        // Continuing a started shift wins: full shifts over fragments.
        const ca = assign[a][d][PAIR[b]] ? 0 : 1;
        const cz = assign[z][d][PAIR[b]] ? 0 : 1;
        if (ca !== cz) return ca - cz;
        const da = blocksOf[a] - bnd[a].minBlocks;
        const dz = blocksOf[z] - bnd[z].minBlocks;
        if (da !== dz) return da - dz;
        const la = leanScore(cfg.staff[a], b);
        const lz = leanScore(cfg.staff[z], b);
        if (la !== lz) return la - lz;
        return rand() - 0.5;
      });
      for (let k = 0; k < need; k++) place(pool[k], d, b);
    }
  }

  // Pass 2: anyone still under their minimum hours gets extra blocks on top of
  // the floor. This is where a third person appears when the hours demand it.
  const slotCount = (d: number, b: number) => {
    let c = 0; for (let e = 0; e < n; e++) if (assign[e][d][b]) c++;
    return c;
  };

  for (let round = 0; round < 60; round++) {
    let progressed = false;
    for (let e = 0; e < n; e++) {
      while (blocksOf[e] < bnd[e].minBlocks) {
        // Best extra slot: complete one of their half-shifts first, then the
        // least crowded slot they can legally take.
        let best: [number, number] | null = null;
        let bestKey = Infinity;
        for (let d = 0; d < DAYS; d++) {
          for (let b = 0; b < BLOCKS; b++) {
            if (!eligible(e, d, b)) continue;
            const completes = assign[e][d][PAIR[b]] ? 0 : 1;
            const crowd = slotCount(d, b);
            const lean = leanScore(cfg.staff[e], b);
            const key = completes * 100 + crowd * 10 + lean;
            if (key < bestKey) { bestKey = key; best = [d, b]; }
          }
        }
        if (!best) break;
        place(e, best[0], best[1]);
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  // Pass 3: swap repair. If someone is still under minimum, try taking a block
  // from a person who is above their own minimum on a slot the short person can work.
  for (let round = 0; round < 40; round++) {
    let changed = false;
    for (let e = 0; e < n; e++) {
      if (blocksOf[e] >= bnd[e].minBlocks) continue;
      let done = false;
      for (let d = 0; d < DAYS && !done; d++) {
        for (let b = 0; b < BLOCKS && !done; b++) {
          if (!eligible(e, d, b)) continue;
          for (let o = 0; o < n; o++) {
            if (o === e || !assign[o][d][b]) continue;
            if (blocksOf[o] <= bnd[o].minBlocks) continue;
            // Removing o must not break their pair into an illegal state; halves are legal.
            unplace(o, d, b);
            if (slotCount(d, b) + 1 >= FLOOR) { // with e added, floor still holds
              place(e, d, b);
              changed = true; done = true;
              break;
            }
            place(o, d, b); // revert
          }
        }
      }
    }
    if (!changed) break;
  }

  // Final hard verification. Anything off, the attempt is discarded.
  for (let d = 0; d < DAYS; d++) {
    for (let b = 0; b < BLOCKS; b++) {
      if (slotCount(d, b) < FLOOR) return null;
    }
  }
  for (let e = 0; e < n; e++) {
    if (blocksOf[e] < bnd[e].minBlocks) return null;
    if (blocksOf[e] > bnd[e].maxBlocks) return null;
    for (let d = 0; d < DAYS; d++) {
      const cur = dayBlocks(e, d);
      if (cur.length > MAX_BLOCKS_PER_DAY) return null;
      if (cur.length === 2 && PAIR[cur[0]] !== cur[1]) return null;
      if (blocked(e, d, 0) && assign[e][d][0]) return null;
      if (d > 0 && workedNight(e, d - 1) && (assign[e][d][0] || assign[e][d][1])) return null;
    }
  }
  return { assign, blocksOf };
}

function score(cfg: Config, bnd: Bounds[], sol: Solution): number {
  const n = cfg.staff.length;
  const w = cfg.weights;
  const we = new Set(cfg.weekendDays);
  let hoursDev = 0, disliked = 0, fragments = 0;
  const nights = new Array(n).fill(0);
  const weekend = new Array(n).fill(0);
  for (let e = 0; e < n; e++) {
    hoursDev += Math.abs(sol.blocksOf[e] - bnd[e].prefBlocks);
    for (let d = 0; d < DAYS; d++) {
      const day = sol.assign[e][d];
      const dayHalf = (day[0] ? 1 : 0) + (day[1] ? 1 : 0);
      const nightHalf = (day[2] ? 1 : 0) + (day[3] ? 1 : 0);
      if (dayHalf === 1) fragments++;
      if (nightHalf === 1) fragments++;
      if (nightHalf > 0) nights[e]++;
      if (we.has(d) && (dayHalf > 0 || nightHalf > 0)) weekend[e]++;
      for (let b = 0; b < BLOCKS; b++) {
        if (day[b] && leanScore(cfg.staff[e], b) === 2) disliked++;
      }
    }
  }
  const spread = (arr: number[]) => Math.max(...arr) - Math.min(...arr);
  return (
    w.hours * hoursDev +
    w.night * spread(nights) +
    w.weekend * spread(weekend) +
    w.lean * disliked +
    w.fragment * fragments
  );
}

export function solve(cfg: Config, budgetMs = 350): SolveResult {
  const problems = validate(cfg);
  if (problems.length) return { status: "INVALID", problems };
  const bnd = bounds(cfg.staff);
  let best: Solution | null = null;
  let bestScore = Infinity;
  const start = Date.now();
  let attempts = 0, feasible = 0;
  const rand = rng(cfg.seed || Math.floor(Math.random() * 1e9));
  while (Date.now() - start < budgetMs && attempts < 4000) {
    attempts++;
    const sol = solveOnce(cfg, bnd, rand);
    if (!sol) continue;
    feasible++;
    const sc = score(cfg, bnd, sol);
    if (sc < bestScore) { bestScore = sc; best = sol; }
  }
  if (!best) {
    return {
      status: "INFEASIBLE",
      problems: [
        "No schedule satisfies every rule as written. Usually too many requests land on the " +
        "same stretch, or someone's minimum hours cannot fit around their requests. " +
        "Relax one request or one minimum and generate again.",
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
    hours[id] = sol.blocksOf[e] * BLOCK_HOURS;
    let nc = 0, wc = 0;
    for (let d = 0; d < DAYS; d++) {
      const day = sol.assign[e][d];
      if (day[2] || day[3]) nc++;
      if (we.has(d) && (day[0] || day[1] || day[2] || day[3])) wc++;
    }
    nights[id] = nc;
    weekends[id] = wc;
  }
  return { hours, nights, weekends };
}
