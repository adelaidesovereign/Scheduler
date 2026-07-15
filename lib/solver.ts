import { Config, Solution, SolveResult, Staff } from "./types";

export const DAYS = 7;
export const BLOCKS = 6;        // 0:8a-12p 1:12p-4p 2:4p-8p | 3:8p-12a 4:12a-4a 5:4a-8a
export const BLOCK_HOURS = 4;
export const FLOOR = 2;         // at least two on, every hour, always
export const MAX_PER_BLOCK = 4;  // never more than four on at once
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
  const dayMin = cfg.staff.reduce((a, s, i) => a + (s.side !== "night" ? b[i].minBlocks : 0), 0);
  if (dayMin > DAYS * 3 * 4) {
    problems.push("Day minimum hours add up to more than four-at-a-time can ever hold. Lower some day minimums.");
  }
  const anchors = cfg.staff.filter((s) => s.anchor && s.side !== "night");
  if (anchors.length === 0) {
    problems.push("No day anchors on the roster. At least one person must be marked as an anchor so every day shift has a lead on.");
  }

  // Name the exact slot that cannot be covered, so the fix is obvious.
  const off = new Set(cfg.blockOff.map((t) => `${t.id}|${t.day}|${t.block}`));
  const label = (d: number) => cfg.dayLabels?.[d] || `day ${d + 1}`;
  const times = ["8a-12p", "12p-4p", "4p-8p"];
  for (let d = 0; d < DAYS; d++) {
    for (let bl = 0; bl < 3; bl++) {
      let avail = 0, anchorAvail = 0;
      for (const st of cfg.staff) {
        if (st.side === "night") continue;
        if (off.has(`${st.id}|${d}|${bl}`)) continue;
        if (st.max <= 0) continue;
        avail++;
        if (st.anchor) anchorAvail++;
      }
      if (avail < FLOOR) {
        problems.push(`${label(d)} ${times[bl]}: only ${avail} day ${avail === 1 ? "person is" : "people are"} available, and every hour needs ${FLOOR}. Free someone up for that slot.`);
      } else if (anchorAvail === 0) {
        problems.push(`${label(d)} ${times[bl]}: no day lead (anchor) is available. Every day hour needs one of your anchors on, so free an anchor for that slot or mark another day person as an anchor.`);
      }
    }
    let nightAvail = 0;
    for (const st of cfg.staff) {
      if (st.side === "day") continue;
      if (off.has(`${st.id}|${d}|3`) || off.has(`${st.id}|${d}|4`) || off.has(`${st.id}|${d}|5`)) continue;
      if (st.max <= 0) continue;
      nightAvail++;
    }
    if (nightAvail < FLOOR) {
      problems.push(`${label(d)} night: only ${nightAvail} night ${nightAvail === 1 ? "person is" : "people are"} available for 8p-8a, and every night needs ${FLOOR}. Free a night person up for that date.`);
    }
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
  // How many day blocks each person could possibly work this week.
  const scarcity: number[] = cfg.staff.map((st, e) => {
    let c = 0;
    for (let d = 0; d < DAYS; d++) for (let b = 0; b < 3; b++) if (!blocked(e, d, b)) c++;
    return c;
  });

  const slotCount = (d: number, b: number) => {
    let c = 0; for (let e = 0; e < n; e++) if (assign[e][d][b]) c++;
    return c;
  };
  const dayRun = (e: number, d: number): number[] => {
    const out: number[] = [];
    for (let b = 0; b < 3; b++) if (assign[e][d][b]) out.push(b);
    return out;
  };
  const onNight = (e: number, d: number) => d >= 0 && d < DAYS && assign[e][d][3];
  const onDaySide = (e: number, d: number) => d >= 0 && d < DAYS && (assign[e][d][0] || assign[e][d][1] || assign[e][d][2]);
  const anchorOn = (d: number, b: number) => {
    for (let e = 0; e < n; e++) if (assign[e][d][b] && cfg.staff[e].anchor) return true;
    return false;
  };

  // ---- Night placement is atomic: the whole 8p-8a or nothing. ----
  const canNight = (e: number, d: number): boolean => {
    const s = cfg.staff[e];
    if (s.side === "day") return false;
    if (slotCount(d, 3) >= MAX_PER_BLOCK) return false;
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
    if (slotCount(d, b) >= MAX_PER_BLOCK) return false;
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
      const nPick = pool.length > 1 && rand() < 0.35 ? 1 : 0;
      placeNight(pool[Math.min(nPick, pool.length - 1)], d);
      have++;
    }
  }

  // ---- Phase 2a: the backbone. Each day starts as two full 8a-8p people
  // wherever the roster allows, so days are built from long shifts, not patchwork. ----
  const canFullDay = (e: number, d: number): boolean => {
    const st = cfg.staff[e];
    if (st.side === "night" || st.maxStretchBlocks < 3) return false;
    if (dayRun(e, d).length > 0) return false;
    if (blocksOf[e] + 3 > bnd[e].maxBlocks) return false;
    if (onNight(e, d) || onNight(e, d - 1)) return false;
    for (let b = 0; b < 3; b++) if (blocked(e, d, b) || slotCount(d, b) >= MAX_PER_BLOCK) return false;
    return true;
  };
  for (let d = 0; d < DAYS; d++) {
    for (let spot = 0; spot < FLOOR; spot++) {
      const needAnchor = !anchorOn(d, 0) && !anchorOn(d, 1) && !anchorOn(d, 2);
      const pool: number[] = [];
      for (let e = 0; e < n; e++) {
        if (!canFullDay(e, d)) continue;
        if (needAnchor && spot === 0 && !cfg.staff[e].anchor) continue;
        pool.push(e);
      }
      if (pool.length === 0) break;
      pool.sort((a, z) => {
        const da = blocksOf[a] - bnd[a].minBlocks;
        const dz = blocksOf[z] - bnd[z].minBlocks;
        if (da !== dz) return da - dz;
        const aa = cfg.staff[a].anchor ? 0 : 1;
        const az = cfg.staff[z].anchor ? 0 : 1;
        if (aa !== az) return aa - az;
        return rand() - 0.5;
      });
      const pick = pool.length > 1 && rand() < 0.35 ? 1 : 0;
      const chosen = pool[Math.min(pick, pool.length - 1)];
      for (let b = 0; b < 3; b++) placeDay(chosen, d, b);
    }
  }

  // ---- Phase 2b: fill whatever the backbone could not cover. ----
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
          if (needAnchor) {
            // Spend the most constrained anchor first where they CAN work,
            // saving flexible anchors for the slots only they can hold.
            if (scarcity[a] !== scarcity[z]) return scarcity[a] - scarcity[z];
          }
          const ca = dayRun(a, d).length > 0 ? 0 : 1;      // keep stretches whole
          const cz = dayRun(z, d).length > 0 ? 0 : 1;
          if (ca !== cz) return ca - cz;
          const da = blocksOf[a] - bnd[a].minBlocks;       // spread work by need first,
          const dz = blocksOf[z] - bnd[z].minBlocks;       // so anchors last the week
          if (da !== dz) return da - dz;
          const pa = cfg.staff[a].primary ? 0 : 1;
          const pz = cfg.staff[z].primary ? 0 : 1;
          if (pa !== pz) return pa - pz;
          return rand() - 0.5;
        });
        // A little variety between attempts finds ways out of tight corners.
        const pick = pool.length > 1 && rand() < 0.35 ? 1 : 0;
        const chosen = pool[Math.min(pick, pool.length - 1)];
        const wasFresh = dayRun(chosen, d).length === 0;
        placeDay(chosen, d, b);
        if (wasFresh) {
          // Ride the same person forward into the day's remaining need.
          for (let nb = b + 1; nb < 3; nb++) {
            if (slotCount(d, nb) >= FLOOR) break;
            if (!canDayBlock(chosen, d, nb)) break;
            placeDay(chosen, d, nb);
          }
          // If that still left a lone 4-hour piece, widen it into a real
          // shift toward whichever side is quieter, even slightly overstaffed.
          if (dayRun(chosen, d).length === 1) {
            const sides = [b - 1, b + 1].filter((x) => x >= 0 && x <= 2 && canDayBlock(chosen, d, x));
            sides.sort((x, y) => slotCount(d, x) - slotCount(d, y));
            if (sides.length > 0) placeDay(chosen, d, sides[0]);
          }
        }
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
          // First choice: extend one of their existing stretches toward a full shift.
          let best: [number, number] | null = null, bestKey = Infinity;
          for (let d = 0; d < DAYS; d++) {
            const run = dayRun(e, d);
            if (run.length === 0) continue;
            for (const b of [run[0] - 1, run[run.length - 1] + 1]) {
              if (b < 0 || b > 2) continue;
              if (!canDayBlock(e, d, b)) continue;
              const key = slotCount(d, b);
              if (key < bestKey) { bestKey = key; best = [d, b]; }
            }
          }
          if (best) { placeDay(e, best[0], best[1]); placed = true; }
          if (!placed) {
            // Otherwise start one clean stretch: as long as their need allows,
            // on the least crowded day, instead of scattering 4-hour pieces.
            const needK = bnd[e].minBlocks - blocksOf[e];
            for (let L = Math.min(3, s.maxStretchBlocks, Math.max(1, needK)); L >= 1 && !placed; L--) {
              let bestS: [number, number] | null = null, bestSKey = Infinity;
              for (let d = 0; d < DAYS; d++) {
                if (dayRun(e, d).length > 0) continue;
                for (let st = 0; st + L <= 3; st++) {
                  let okAll = true, crowd = 0;
                  for (let b = st; b < st + L; b++) {
                    if (assign[e][d][b] || blocked(e, d, b) || slotCount(d, b) >= MAX_PER_BLOCK) { okAll = false; break; }
                    crowd += slotCount(d, b);
                  }
                  if (!okAll) continue;
                  if (onNight(e, d) || onNight(e, d - 1)) continue;
                  if (blocksOf[e] + L > bnd[e].maxBlocks) continue;
                  if (crowd < bestSKey) { bestSKey = crowd; bestS = [d, st]; }
                }
              }
              if (bestS) {
                for (let b = bestS[1]; b < bestS[1] + L; b++) placeDay(e, bestS[0], b);
                placed = true;
              }
            }
          }
        }
        if (!placed) break;
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  // ---- Phase 3b: top up toward targets by lengthening existing stretches only. ----
  for (let round = 0; round < 3; round++) {
    let grew = false;
    for (let e = 0; e < n; e++) {
      if (cfg.staff[e].side === "night") continue;
      while (blocksOf[e] < bnd[e].prefBlocks) {
        let best: [number, number] | null = null, bestKey = Infinity;
        for (let d = 0; d < DAYS; d++) {
          const run = dayRun(e, d);
          if (run.length === 0) continue;
          for (const b of [run[0] - 1, run[run.length - 1] + 1]) {
            if (b < 0 || b > 2) continue;
            if (!canDayBlock(e, d, b)) continue;
            const key = slotCount(d, b);
            if (key < bestKey) { bestKey = key; best = [d, b]; }
          }
        }
        if (!best) break;
        placeDay(e, best[0], best[1]);
        grew = true;
      }
    }
    if (!grew) break;
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

  // ---- Phase 5: erase lone 4-hour pieces where the rules allow. ----
  for (let round = 0; round < 3; round++) {
    let cleaned = false;
    for (let e = 0; e < n; e++) {
      for (let d = 0; d < DAYS; d++) {
        const run = dayRun(e, d);
        if (run.length !== 1) continue;
        const b = run[0];
        // Try to grow it into a real stretch first.
        let grown = false;
        for (const nb of [b - 1, b + 1]) {
          if (nb < 0 || nb > 2) continue;
          if (canDayBlock(e, d, nb)) { placeDay(e, d, nb); grown = true; cleaned = true; break; }
        }
        if (grown) continue;
        // Otherwise hand the block to someone already working next to it,
        // as long as the floor, the anchor, and this person's minimum all hold.
        if (blocksOf[e] - 1 < bnd[e].minBlocks) continue;
        if (slotCount(d, b) - 1 < FLOOR) continue;
        if (cfg.staff[e].anchor) {
          let otherAnchor = false;
          for (let x = 0; x < n; x++) {
            if (x !== e && assign[x][d][b] && cfg.staff[x].anchor) { otherAnchor = true; break; }
          }
          if (!otherAnchor) continue;
        }
        removeDay(e, d, b);
        cleaned = true;
      }
    }
    if (!cleaned) break;
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
  let hoursDev = 0, fragments = 0, crowding = 0;
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
      if (run === 1) fragments += 3;        // a lone 4-hour piece is a last resort
      else if (run === 2) fragments += 1;   // 8 hours is fine, 12 is best
      if (day[3]) nightsWorked++;
      if (we.has(d) && (run > 0 || day[3])) weekend[e]++;
    }
    weekend[e] += cW[e];
    if (cfg.staff[e].side !== "day") nightCounts.push(nightsWorked + cN[e]);
  }
  for (let d = 0; d < DAYS; d++) {
    let chips = 0;
    for (let e = 0; e < n; e++) {
      if (sol.assign[e][d][0] || sol.assign[e][d][1] || sol.assign[e][d][2]) chips++;
    }
    crowding += Math.max(0, chips - 2) + 3 * Math.max(0, chips - 3) + 10 * Math.max(0, chips - 4);
  }
  const spread = (arr: number[]) => arr.length ? Math.max(...arr) - Math.min(...arr) : 0;
  return (
    (w.hours ?? 100) * hoursDev +
    (w.night ?? 0) * spread(nightCounts) +
    (w.weekend ?? 0) * spread(weekend) +
    (w.fragment ?? 0) * fragments +
    (w.crowd ?? 0) * crowding
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
