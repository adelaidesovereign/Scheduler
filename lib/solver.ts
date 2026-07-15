import { Config, Solution, SolveResult, Staff } from "./types";

export const DAYS = 7;
export const BLOCKS = 6;        // 0:8a-12p 1:12p-4p 2:4p-8p | 3:8p-12a 4:12a-4a 5:4a-8a
export const BLOCK_HOURS = 4;
export const FLOOR = 2;         // at least two on, every hour, always
const NIGHT = [3, 4, 5];        // the night shift is one piece: 8p-8a, always 12 hours

const isDaySide = (b: number) => b < 3;

interface Bounds { minBlocks: number; maxBlocks: number; prefBlocks: number; }

function bounds(staff: Staff[]): Bounds[] {
  return staff.map((s) => {
    if (s.side === "night") {
      // Nights are whole 8p-8a shifts, so night hours round to whole nights.
      const minN = Math.max(0, Math.round(s.min / 12));
      const maxN = Math.max(minN, Math.floor(s.max / 12) || minN);
      const prefN = Math.min(Math.max(Math.round(s.pref / 12), minN), maxN);
      return { minBlocks: minN * 3, maxBlocks: Math.min(maxN * 3, DAYS * 3), prefBlocks: prefN * 3 };
    }
    return {
      minBlocks: Math.ceil(s.min / BLOCK_HOURS),
      maxBlocks: Math.min(Math.floor(s.max / BLOCK_HOURS), DAYS * 3),
      prefBlocks: Math.round(s.pref / BLOCK_HOURS),
    };
  });
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
  // Anchors must be able to cover every day hour: 21 day blocks a week.
  const anchorCap = cfg.staff.reduce((a, s, i) => a + (s.anchor && s.side !== "night" ? b[i].maxBlocks : 0), 0);
  if (anchorCap < DAYS * 3) {
    problems.push("Your day leads (anchors) cannot cover every day hour of the week between them. Raise an anchor's Max hours or mark another day person as an anchor.");
  }
  // Day-side capacity: 21 day-block slots x 2 = 168 hours must come from day-capable staff.
  const dayCap = cfg.staff.reduce((a, s, i) => a + (s.side !== "night" ? b[i].maxBlocks : 0), 0);
  if (dayCap * BLOCK_HOURS < DAYS * 3 * FLOOR * BLOCK_HOURS) {
    problems.push("Day coverage cannot be held: day-capable staff maximums are below the 168 hours the day side needs. Raise a day person's Max or add day staff.");
  }
  const nightCap = cfg.staff.reduce((a, s, i) => a + (s.side !== "day" ? b[i].maxBlocks : 0), 0);
  if (nightCap * BLOCK_HOURS < DAYS * 3 * FLOOR * BLOCK_HOURS) {
    problems.push("Night coverage cannot be held: night-capable staff maximums are below the 168 hours the night side needs. Raise a night person's Max or add night staff.");
  }
  const anchors = cfg.staff.filter((s) => s.anchor && s.side !== "night");
  if (anchors.length === 0) {
    problems.push("No day anchors on the roster. At least one person must be marked as an anchor so every day shift has a lead on.");
  }
  return problems;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function solveOnce(cfg: Config, bnd: Bounds[], rand: () => number): Solution | null {
  const n = cfg.staff.length;
  const assign: boolean[][][] = Array.from({ length: n }, () =>
    Array.from({ length: DAYS }, () => new Array(BLOCKS).fill(false))
  );
  const blocksOf = new Array(n).fill(0);

  const off = new Set(cfg.blockOff.map((t) => `${t.id}|${t.day}|${t.block}`));
  const blocked = (e: number, d: number, b: number) => off.has(`${cfg.staff[e].id}|${d}|${b}`);

  const dayRun = (e: number, d: number): number[] => {
    const out: number[] = [];
    for (let b = 0; b < 3; b++) if (assign[e][d][b]) out.push(b);
    return out;
  };
  const onNight = (e: number, d: number) => d >= 0 && d < DAYS && assign[e][d][3];
  const onDaySide = (e: number, d: number) => d >= 0 && d < DAYS && (assign[e][d][0] || assign[e][d][1] || assign[e][d][2]);
  const slotCount = (d: number, b: number) => {
    let c = 0; for (let e = 0; e < n; e++) if (assign[e][d][b]) c++;
    return c;
  };
  const anchorOn = (d: number, b: number) => {
    for (let e = 0; e < n; e++) if (assign[e][d][b] && cfg.staff[e].anchor) return true;
    return false;
  };

  // ---- Night placement is atomic: the whole 8p-8a or nothing. ----
  const canNight = (e: number, d: number): boolean => {
    const s = cfg.staff[e];
    if (s.side === "day") return false;
    if (blocksOf[e] + 3 > bnd[e].maxBlocks) return false;
    if (onNight(e, d)) return false;
    if (onDaySide(e, d)) return false;                    // no day into night same day
    if (onDaySide(e, d + 1)) return false;                // no night into next-day work
    for (const b of NIGHT) if (blocked(e, d, b)) return false;
    return true;
  };
  const placeNight = (e: number, d: number) => { for (const b of NIGHT) assign[e][d][b] = true; blocksOf[e] += 3; };
  const removeNight = (e: number, d: number) => { for (const b of NIGHT) assign[e][d][b] = false; blocksOf[e] -= 3; };

  // ---- Day placement: contiguous stretch, capped by the person's own limit. ----
  const canDayBlock = (e: number, d: number, b: number): boolean => {
    const s = cfg.staff[e];
    if (s.side === "night") return false;
    if (assign[e][d][b]) return false;
    if (blocksOf[e] >= bnd[e].maxBlocks) return false;
    if (blocked(e, d, b)) return false;
    if (onNight(e, d)) return false;                      // no night into day same op-day
    if (onNight(e, d - 1)) return false;                  // rest after a night
    const run = dayRun(e, d);
    if (run.length >= s.maxStretchBlocks) return false;   // 8h people stop at 8h
    if (run.length > 0 && b !== run[0] - 1 && b !== run[run.length - 1] + 1) return false;
    return true;
  };
  const placeDay = (e: number, d: number, b: number) => { assign[e][d][b] = true; blocksOf[e]++; };
  const removeDay = (e: number, d: number, b: number) => { assign[e][d][b] = false; blocksOf[e]--; };

  // ---- Phase 1: nights. Two full-night crews per night, every night. ----
  for (let d = 0; d < DAYS; d++) {
    let have = slotCount(d, 3);
    while (have < FLOOR) {
      const pool: number[] = [];
      for (let e = 0; e < n; e++) if (canNight(e, d)) pool.push(e);
      if (pool.length === 0) return null;
      pool.sort((a, z) => {
        const da = blocksOf[a] - bnd[a].minBlocks;
        const dz = blocksOf[z] - bnd[z].minBlocks;
        if (da !== dz) return da - dz;                     // furthest below their hours first
        const sa = cfg.staff[a].side === "night" ? 0 : 1;  // true night staff before flex
        const sz = cfg.staff[z].side === "night" ? 0 : 1;
        if (sa !== sz) return sa - sz;
        return rand() - 0.5;
      });
      placeNight(pool[0], d);
      have++;
    }
  }

  // ---- Phase 2: days. Every day block needs two on, one of them an anchor. ----
  for (let d = 0; d < DAYS; d++) {
    for (let b = 0; b < 3; b++) {
      while (slotCount(d, b) < FLOOR || !anchorOn(d, b)) {
        const needAnchor = !anchorOn(d, b);
        const pool: number[] = [];
        for (let e = 0; e < n; e++) {
          if (!canDayBlock(e, d, b)) continue;
          if (needAnchor && !cfg.staff[e].anchor) continue;
          pool.push(e);
        }
        if (pool.length === 0) return null;
        pool.sort((a, z) => {
          const ca = dayRun(a, d).length > 0 ? 0 : 1;      // keep stretches whole
          const cz = dayRun(z, d).length > 0 ? 0 : 1;
          if (ca !== cz) return ca - cz;
          const pa = cfg.staff[a].primary ? 0 : 1;         // primaries come first
          const pz = cfg.staff[z].primary ? 0 : 1;
          if (pa !== pz) return pa - pz;
          const da = blocksOf[a] - bnd[a].minBlocks;
          const dz = blocksOf[z] - bnd[z].minBlocks;
          if (da !== dz) return da - dz;
          return rand() - 0.5;
        });
        placeDay(pool[0], d, b);
        if (slotCount(d, b) >= FLOOR && anchorOn(d, b)) break;
      }
    }
  }

  // ---- Phase 3: land everyone's minimum hours with extras on top of the floor. ----
  for (let round = 0; round < 80; round++) {
    let progressed = false;
    for (let e = 0; e < n; e++) {
      while (blocksOf[e] < bnd[e].minBlocks) {
        const s = cfg.staff[e];
        let placed = false;
        if (s.side === "night" || (s.side === "any" && bnd[e].minBlocks - blocksOf[e] >= 3)) {
          let bestD = -1, bestCrowd = Infinity;
          for (let d = 0; d < DAYS; d++) {
            if (!canNight(e, d)) continue;
            const crowd = slotCount(d, 3);
            if (crowd < bestCrowd) { bestCrowd = crowd; bestD = d; }
          }
          if (bestD >= 0) { placeNight(e, bestD); placed = true; }
        }
        if (!placed && s.side !== "night") {
          let best: [number, number] | null = null, bestKey = Infinity;
          for (let d = 0; d < DAYS; d++) {
            for (let b = 0; b < 3; b++) {
              if (!canDayBlock(e, d, b)) continue;
              const key = (dayRun(e, d).length > 0 ? 0 : 100) + slotCount(d, b) * 10;
              if (key < bestKey) { bestKey = key; best = [d, b]; }
            }
          }
          if (best) { placeDay(e, best[0], best[1]); placed = true; }
        }
        if (!placed) break;
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  // ---- Phase 4: swap repair for anyone still short. ----
  for (let round = 0; round < 40; round++) {
    let changed = false;
    for (let e = 0; e < n; e++) {
      if (blocksOf[e] >= bnd[e].minBlocks) continue;
      const s = cfg.staff[e];
      let done = false;
      // whole-night swaps
      if (!done && s.side !== "day") {
        for (let d = 0; d < DAYS && !done; d++) {
          if (!canNight(e, d)) continue;
          for (let o = 0; o < n; o++) {
            if (o === e || !assign[o][d][3]) continue;
            if (blocksOf[o] - 3 < bnd[o].minBlocks) continue;
            removeNight(o, d);
            placeNight(e, d);
            changed = true; done = true;
            break;
          }
        }
      }
      // day-block swaps, endpoints only, never stripping a slot's last anchor
      if (!done && s.side !== "night") {
        for (let d = 0; d < DAYS && !done; d++) {
          for (let b = 0; b < 3 && !done; b++) {
            if (!canDayBlock(e, d, b)) continue;
            for (let o = 0; o < n; o++) {
              if (o === e || !assign[o][d][b]) continue;
              if (blocksOf[o] <= bnd[o].minBlocks) continue;
              const run = dayRun(o, d);
              if (b !== run[0] && b !== run[run.length - 1]) continue;
              if (cfg.staff[o].anchor && !cfg.staff[e].anchor) {
                let otherAnchor = false;
                for (let x = 0; x < n; x++) {
                  if (x !== o && assign[x][d][b] && cfg.staff[x].anchor) { otherAnchor = true; break; }
                }
                if (!otherAnchor) continue;
              }
              removeDay(o, d, b);
              placeDay(e, d, b);
              changed = true; done = true;
              break;
            }
          }
        }
      }
    }
    if (!changed) break;
  }

  // ---- Final verification of every hard rule. ----
  for (let d = 0; d < DAYS; d++) {
    for (let b = 0; b < BLOCKS; b++) if (slotCount(d, b) < FLOOR) return null;
    for (let b = 0; b < 3; b++) if (!anchorOn(d, b)) return null;
  }
  for (let e = 0; e < n; e++) {
    const s = cfg.staff[e];
    if (blocksOf[e] < bnd[e].minBlocks || blocksOf[e] > bnd[e].maxBlocks) return null;
    for (let d = 0; d < DAYS; d++) {
      const nightBlocks = NIGHT.filter((b) => assign[e][d][b]).length;
      if (nightBlocks !== 0 && nightBlocks !== 3) return null;          // whole nights only
      if (nightBlocks > 0 && s.side === "day") return null;
      const run = dayRun(e, d);
      if (run.length > 0 && s.side === "night") return null;
      if (run.length > s.maxStretchBlocks) return null;
      for (let k = 1; k < run.length; k++) if (run[k] !== run[k - 1] + 1) return null;
      if (nightBlocks > 0 && run.length > 0) return null;
      for (let b = 0; b < BLOCKS; b++) if (assign[e][d][b] && blocked(e, d, b)) return null;
      if (d > 0 && onNight(e, d - 1) && run.length > 0) return null;
    }
  }
  return { assign, blocksOf };
}

function score(cfg: Config, bnd: Bounds[], sol: Solution): number {
  const n = cfg.staff.length;
  const w = cfg.weights;
  const we = new Set(cfg.weekendDays);
  let hoursDev = 0, fragments = 0;
  const nightCounts: number[] = [];
  const weekend = new Array(n).fill(0);
  const cN = cfg.carryNights || new Array(n).fill(0);
  const cW = cfg.carryWeekends || new Array(n).fill(0);
  for (let e = 0; e < n; e++) {
    const dev = Math.abs(sol.blocksOf[e] - bnd[e].prefBlocks);
    hoursDev += cfg.staff[e].primary ? dev * 2 : dev;      // primaries protected hardest
    let nightsWorked = 0;
    for (let d = 0; d < DAYS; d++) {
      const day = sol.assign[e][d];
      let run = 0;
      for (let b = 0; b < 3; b++) if (day[b]) run++;
      if (run > 0) fragments += Math.max(0, cfg.staff[e].maxStretchBlocks - run);
      if (day[3]) nightsWorked++;
      if (we.has(d) && (run > 0 || day[3])) weekend[e]++;
    }
    weekend[e] += cW[e];
    if (cfg.staff[e].side !== "day") nightCounts.push(nightsWorked + cN[e]);
  }
  const spread = (arr: number[]) => arr.length ? Math.max(...arr) - Math.min(...arr) : 0;
  return (
    w.hours * hoursDev +
    w.night * spread(nightCounts) +
    w.weekend * spread(weekend) +
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
        "No schedule satisfies every rule as written. Check that enough night staff are free each night, " +
        "that an anchor (a day lead) is available for every day hour, and that requests have not boxed in " +
        "someone's minimum hours. Relax one and generate again.",
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
      if (day[3]) nc++;
      if (we.has(d) && day.some(Boolean)) wc++;
    }
    nights[id] = nc;
    weekends[id] = wc;
  }
  return { hours, nights, weekends };
}
