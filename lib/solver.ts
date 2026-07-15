import { Config, Solution, SolveResult, Staff } from "./types";

export const DAYS = 7;
// Six 4-hour blocks per operational day (8a to 8a next morning):
// 0: 8a-12p, 1: 12p-4p, 2: 4p-8p   (day side)
// 3: 8p-12a, 4: 12a-4a, 5: 4a-8a   (night side)
export const BLOCKS = 6;
export const BLOCK_HOURS = 4;
export const FLOOR = 2;             // at least two on, every hour, always
export const MAX_BLOCKS_PER_DAY = 3; // 12 hours in one day, no more

const isDaySide = (b: number) => b < 3;

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
  if (staff.lean === "day") return isDaySide(b) ? 0 : 2;
  return isDaySide(b) ? 2 : 0;
}

function solveOnce(cfg: Config, bnd: Bounds[], rand: () => number): Solution | null {
  const n = cfg.staff.length;
  const assign: boolean[][][] = Array.from({ length: n }, () =>
    Array.from({ length: DAYS }, () => new Array(BLOCKS).fill(false))
  );
  const blocksOf = new Array(n).fill(0);

  const off = new Set(cfg.blockOff.map((t) => `${t.id}|${t.day}|${t.block}`));
  const blocked = (e: number, d: number, b: number) => off.has(`${cfg.staff[e].id}|${d}|${b}`);

  const dayBlocks = (e: number, d: number): number[] => {
    const out: number[] = [];
    for (let b = 0; b < BLOCKS; b++) if (assign[e][d][b]) out.push(b);
    return out;
  };
  const workedNight = (e: number, d: number) =>
    d >= 0 && (assign[e][d][3] || assign[e][d][4] || assign[e][d][5]);
  const worksDaySide = (e: number, d: number) =>
    d < DAYS && (assign[e][d][0] || assign[e][d][1] || assign[e][d][2]);

  // One contiguous stretch per person per operational day, inside one side,
  // at most 12 hours. Any start, any length the week needs: 4p-8p, 12p-8p, 8a-8p.
  const eligible = (e: number, d: number, b: number): boolean => {
    if (assign[e][d][b]) return false;
    if (blocksOf[e] >= bnd[e].maxBlocks) return false;
    if (blocked(e, d, b)) return false;
    const cur = dayBlocks(e, d);
    if (cur.length >= MAX_BLOCKS_PER_DAY) return false;
    if (cur.length > 0) {
      if (isDaySide(cur[0]) !== isDaySide(b)) return false;      // stay on one side
      const lo = cur[0], hi = cur[cur.length - 1];
      if (b !== lo - 1 && b !== hi + 1) return false;            // extend the stretch only
    }
    if (isDaySide(b) && workedNight(e, d - 1)) return false;      // rest after nights
    if (!isDaySide(b) && worksDaySide(e, d + 1)) return false;
    return true;
  };

  const place = (e: number, d: number, b: number) => { assign[e][d][b] = true; blocksOf[e]++; };
  const unplace = (e: number, d: number, b: number) => { assign[e][d][b] = false; blocksOf[e]--; };
  const slotCount = (d: number, b: number) => {
    let c = 0; for (let e = 0; e < n; e++) if (assign[e][d][b]) c++;
    return c;
  };

  // Pass 1: hold the two-person floor across all 42 block-slots, chronologically.
  for (let d = 0; d < DAYS; d++) {
    for (let b = 0; b < BLOCKS; b++) {
      let need = FLOOR - slotCount(d, b);
      if (need <= 0) continue;
      const pool: number[] = [];
      for (let e = 0; e < n; e++) if (eligible(e, d, b)) pool.push(e);
      if (pool.length < need) return null;
      pool.sort((a, z) => {
        const ca = dayBlocks(a, d).length > 0 ? 0 : 1;   // continue a started stretch
        const cz = dayBlocks(z, d).length > 0 ? 0 : 1;
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

  // Pass 2: whoever is under their minimum gets extra blocks on top of the
  // floor. Prefer extending an existing stretch, then the least crowded slot.
  for (let round = 0; round < 80; round++) {
    let progressed = false;
    for (let e = 0; e < n; e++) {
      while (blocksOf[e] < bnd[e].minBlocks) {
        let best: [number, number] | null = null;
        let bestKey = Infinity;
        for (let d = 0; d < DAYS; d++) {
          for (let b = 0; b < BLOCKS; b++) {
            if (!eligible(e, d, b)) continue;
            const extends_ = dayBlocks(e, d).length > 0 ? 0 : 1;
            const key = extends_ * 100 + slotCount(d, b) * 10 + leanScore(cfg.staff[e], b);
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

  // Pass 3: swap repair for anyone still short. Only take a block from the
  // end of someone's stretch so their remaining time stays contiguous.
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
            const run = dayBlocks(o, d);
            if (b !== run[0] && b !== run[run.length - 1]) continue; // endpoints only
            unplace(o, d, b);
            if (slotCount(d, b) + 1 >= FLOOR) {
              place(e, d, b);
              changed = true; done = true;
              break;
            }
            place(o, d, b);
          }
        }
      }
    }
    if (!changed) break;
  }

  // Final hard verification. Anything off, this attempt is thrown away.
  for (let d = 0; d < DAYS; d++) {
    for (let b = 0; b < BLOCKS; b++) if (slotCount(d, b) < FLOOR) return null;
  }
  for (let e = 0; e < n; e++) {
    if (blocksOf[e] < bnd[e].minBlocks) return null;
    if (blocksOf[e] > bnd[e].maxBlocks) return null;
    for (let d = 0; d < DAYS; d++) {
      const cur = dayBlocks(e, d);
      if (cur.length > MAX_BLOCKS_PER_DAY) return null;
      if (cur.length > 1) {
        if (isDaySide(cur[0]) !== isDaySide(cur[cur.length - 1])) return null;
        for (let k = 1; k < cur.length; k++) if (cur[k] !== cur[k - 1] + 1) return null;
      }
      for (const b of cur) if (blocked(e, d, b)) return null;
      if (d > 0 && workedNight(e, d - 1) && (cur.length > 0 && isDaySide(cur[0]))) return null;
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
      let run = 0, nightWork = false, any = false;
      for (let b = 0; b < BLOCKS; b++) {
        if (!day[b]) continue;
        run++; any = true;
        if (!isDaySide(b)) nightWork = true;
        if (leanScore(cfg.staff[e], b) === 2) disliked++;
      }
      if (any) fragments += Math.max(0, MAX_BLOCKS_PER_DAY - run); // short stretches cost a little
      if (nightWork) nights[e]++;
      if (we.has(d) && any) weekend[e]++;
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

export function solve(cfg: Config, budgetMs = 400): SolveResult {
  const problems = validate(cfg);
  if (problems.length) return { status: "INVALID", problems };
  const bnd = bounds(cfg.staff);
  let best: Solution | null = null;
  let bestScore = Infinity;
  const start = Date.now();
  let attempts = 0, feasible = 0;
  const rand = rng(cfg.seed || Math.floor(Math.random() * 1e9));
  while (Date.now() - start < budgetMs && attempts < 3000) {
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
      const any = day.some(Boolean);
      if (day[3] || day[4] || day[5]) nc++;
      if (we.has(d) && any) wc++;
    }
    nights[id] = nc;
    weekends[id] = wc;
  }
  return { hours, nights, weekends };
}
