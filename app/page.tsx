"use client";

import { useMemo, useState } from "react";
import { solve, summarize, DAYS } from "@/lib/solver";
import { Config, Lean, Staff, TimeOff } from "@/lib/types";

const PALETTE = [
  "#F4C6DA", "#D8C6F0", "#FBE39A", "#F7CB98", "#F4A6A6", "#9BE5EE",
  "#BFE0F6", "#F3E4B4", "#C9E7BC", "#F1B9CA", "#C9D6F0", "#E8D2B2",
];
const colorFor = (i: number) => PALETTE[i % PALETTE.length];
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DAY_START = 8;    // 8 AM, fixed
const NIGHT_START = 20; // 8 PM, fixed

// Roster rows hold hours as text so typing feels natural on a phone.
interface RosterRow { id: string; pref: string; min: string; max: string; lean: Lean; }

// A request can block a shift, a whole day, or a custom window like an appointment.
interface Request {
  id: string;
  day: number;
  kind: "all" | "day" | "night" | "custom";
  from: string; // "08:00" when kind is custom
  to: string;   // "12:00"
}

const START_ROSTER: RosterRow[] = [
  { id: "CT", pref: "36", min: "24", max: "48", lean: "day" },
  { id: "CM", pref: "24", min: "12", max: "36", lean: "day" },
  { id: "AT", pref: "36", min: "24", max: "48", lean: "day" },
  { id: "AD", pref: "36", min: "24", max: "48", lean: "any" },
  { id: "KH", pref: "24", min: "12", max: "36", lean: "day" },
  { id: "EH", pref: "36", min: "24", max: "48", lean: "night" },
  { id: "SL", pref: "36", min: "24", max: "48", lean: "night" },
  { id: "WR", pref: "36", min: "24", max: "48", lean: "night" },
  { id: "VT", pref: "24", min: "12", max: "36", lean: "night" },
  { id: "R1", pref: "24", min: "12", max: "36", lean: "any" },
  { id: "R2", pref: "24", min: "12", max: "36", lean: "any" },
  { id: "R3", pref: "24", min: "12", max: "36", lean: "any" },
];

function toNum(v: string): number {
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < 0) return 0;
  return Math.min(n, 84);
}

function fmtHour(h: number): string {
  const suffix = h < 12 ? "AM" : "PM";
  let base = h % 12;
  if (base === 0) base = 12;
  return `${base} ${suffix}`;
}

function fmtClock(t: string): string {
  const [hs, ms] = t.split(":");
  let h = parseInt(hs, 10);
  const suffix = h < 12 ? "a" : "p";
  h = h % 12; if (h === 0) h = 12;
  return ms === "00" ? `${h}${suffix}` : `${h}:${ms}${suffix}`;
}

function addDays(iso: string, n: number): Date {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d;
}

// Turn a custom window into the shifts it actually collides with.
// Day shift runs 8:00 to 20:00. Night shift of day d runs 20:00 to 8:00 the next morning.
// So early morning hours on day d belong to the night shift that started on day d-1.
function expandRequests(reqs: Request[]): TimeOff[] {
  const out: TimeOff[] = [];
  for (const r of reqs) {
    if (r.kind !== "custom") {
      out.push({ id: r.id, day: r.day, shift: r.kind });
      continue;
    }
    const from = parseInt(r.from.split(":")[0], 10) + parseInt(r.from.split(":")[1], 10) / 60;
    const to = parseInt(r.to.split(":")[0], 10) + parseInt(r.to.split(":")[1], 10) / 60;
    if (!(to > from)) continue; // ignore an empty or reversed window
    const overlaps = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && b1 < a2;
    if (overlaps(from, to, DAY_START, NIGHT_START)) out.push({ id: r.id, day: r.day, shift: "day" });
    if (overlaps(from, to, NIGHT_START, 24)) out.push({ id: r.id, day: r.day, shift: "night" });
    if (overlaps(from, to, 0, DAY_START) && r.day > 0) out.push({ id: r.id, day: r.day - 1, shift: "night" });
  }
  return out;
}

export default function Page() {
  const [weekStart, setWeekStart] = useState("2026-07-17");
  const [staff, setStaff] = useState<RosterRow[]>(START_ROSTER);
  const [requests, setRequests] = useState<Request[]>([]);
  const [result, setResult] = useState<ReturnType<typeof solve> | null>(null);
  const [cfgUsed, setCfgUsed] = useState<Config | null>(null);

  const startDow = useMemo(() => new Date(weekStart + "T00:00:00").getDay(), [weekStart]);
  const weekendDays = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < DAYS; i++) {
      const dow = (startDow + i) % 7;
      if (dow === 0 || dow === 6) out.push(i);
    }
    return out;
  }, [startDow]);

  // Live capacity readout so an impossible week is visible before generating.
  const capacity = useMemo(() => {
    const needed = DAYS * 2 * 2; // 28 shifts
    let minS = 0, maxS = 0, prefS = 0;
    for (const s of staff) {
      minS += Math.ceil(toNum(s.min) / 12);
      maxS += Math.floor(toNum(s.max) / 12);
      prefS += Math.round(toNum(s.pref) / 12);
    }
    return { needed, minS, maxS, prefS };
  }, [staff]);

  function updateStaff(i: number, patch: Partial<RosterRow>) {
    setStaff((s) => s.map((row, k) => (k === i ? { ...row, ...patch } : row)));
  }
  function removeStaff(i: number) { setStaff((s) => s.filter((_, k) => k !== i)); }
  function addStaff() {
    setStaff((s) => [...s, { id: "NEW", pref: "24", min: "12", max: "36", lean: "any" }]);
  }
  function addRequest() {
    setRequests((t) => [...t, { id: staff[0]?.id || "", day: 0, kind: "all", from: "08:00", to: "12:00" }]);
  }
  function updateRequest(i: number, patch: Partial<Request>) {
    setRequests((t) => t.map((row, k) => (k === i ? { ...row, ...patch } : row)));
  }
  function removeRequest(i: number) { setRequests((t) => t.filter((_, k) => k !== i)); }

  function generate() {
    const cleanStaff: Staff[] = staff.map((s) => ({
      id: s.id.trim() || "??",
      pref: toNum(s.pref),
      min: toNum(s.min),
      max: toNum(s.max),
      lean: s.lean,
    }));
    const cfg: Config = {
      staff: cleanStaff,
      dayStartHour: DAY_START,
      nightStartHour: NIGHT_START,
      shiftLengthHours: 12,
      staffPerShift: 2,
      timeOff: expandRequests(requests),
      locked: [],
      weights: { hours: 100, night: 8, weekend: 6, lean: 4 },
      weekendDays,
      seed: Math.floor(Math.random() * 1e9),
    };
    setCfgUsed(cfg);
    try {
      setResult(solve(cfg, 300));
    } catch (err) {
      setResult({
        status: "INVALID",
        problems: [
          "Something in the inputs broke the engine: " + String(err) +
          ". Check for blank initials or hours, fix, and generate again.",
        ],
      });
    }
  }

  const colorIndex = useMemo(() => {
    const m: Record<string, number> = {};
    staff.forEach((s, i) => (m[s.id] = i));
    return m;
  }, [staff]);

  const rangeLabel = useMemo(() => {
    const a = addDays(weekStart, 0);
    const b = addDays(weekStart, 6);
    const opt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${a.toLocaleDateString("en-US", opt)} to ${b.toLocaleDateString("en-US", opt)}`;
  }, [weekStart]);

  const selectAll = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

  const capBad = capacity.minS > capacity.needed || capacity.maxS < capacity.needed;

  return (
    <div className="wrap">
      <div className="masthead">
        <div>
          <p className="eyebrow">Operations · Coverage Engine</p>
          <h1>Schedule Automator</h1>
        </div>
        <div className="meta">
          <span className="big">{rangeLabel}</span>
          <br />
          two on the floor · {fmtHour(DAY_START)} to {fmtHour(NIGHT_START)} · {fmtHour(NIGHT_START)} to {fmtHour(DAY_START)}
        </div>
      </div>
      <div className="hairline" />

      <div className="layout">
        <div>
          <div className="panel">
            <h2>Week</h2>
            <div className="field">
              <label>Week starts</label>
              <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
            </div>
          </div>

          <div className="panel">
            <h2>Roster · Weekly Hours</h2>
            <table className="roster">
              <thead>
                <tr>
                  <th></th><th>ID</th><th>Pref</th><th>Min</th><th>Max</th><th>Lean</th><th></th>
                </tr>
              </thead>
              <tbody>
                {staff.map((row, i) => (
                  <tr key={i}>
                    <td><span className="swatch" style={{ background: colorFor(i) }} /></td>
                    <td className="idcell" style={{ width: 42 }}>
                      <input type="text" value={row.id} maxLength={4} onFocus={selectAll}
                        onChange={(e) => updateStaff(i, { id: e.target.value.toUpperCase() })} />
                    </td>
                    <td style={{ width: 50 }}>
                      <input type="text" inputMode="numeric" pattern="[0-9]*" value={row.pref} onFocus={selectAll}
                        onChange={(e) => updateStaff(i, { pref: e.target.value.replace(/[^0-9]/g, "") })} />
                    </td>
                    <td style={{ width: 50 }}>
                      <input type="text" inputMode="numeric" pattern="[0-9]*" value={row.min} onFocus={selectAll}
                        onChange={(e) => updateStaff(i, { min: e.target.value.replace(/[^0-9]/g, "") })} />
                    </td>
                    <td style={{ width: 50 }}>
                      <input type="text" inputMode="numeric" pattern="[0-9]*" value={row.max} onFocus={selectAll}
                        onChange={(e) => updateStaff(i, { max: e.target.value.replace(/[^0-9]/g, "") })} />
                    </td>
                    <td>
                      <select value={row.lean} onChange={(e) => updateStaff(i, { lean: e.target.value as Lean })}>
                        <option value="day">day</option>
                        <option value="night">night</option>
                        <option value="any">any</option>
                      </select>
                    </td>
                    <td><button className="rowdrop" onClick={() => removeStaff(i)} title="Remove">×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="addrow" onClick={addStaff}>+ Add staff</button>
            <div className={`capline ${capBad ? "bad" : ""}`}>
              Week holds {capacity.needed} shifts · minimums claim {capacity.minS} · maximums allow {capacity.maxS} · targets total {capacity.prefS}
              {capacity.minS > capacity.needed && <span> — minimums exceed the week, lower some Min hours</span>}
              {capacity.maxS < capacity.needed && <span> — maximums cannot cover the week, raise some Max hours</span>}
            </div>
          </div>

          <div className="panel">
            <h2>Time Off Requests</h2>
            {requests.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 10px" }}>
                None yet. Block a whole day, one shift, or a window like an appointment.
              </p>
            )}
            {requests.map((req, i) => (
              <div className="reqblock" key={i}>
                <div className="reqrow">
                  <select value={req.id} onChange={(e) => updateRequest(i, { id: e.target.value })}>
                    {staff.map((s, k) => <option key={k} value={s.id}>{s.id}</option>)}
                  </select>
                  <select value={req.day} onChange={(e) => updateRequest(i, { day: +e.target.value })}>
                    {Array.from({ length: DAYS }).map((_, d) => {
                      const dt = addDays(weekStart, d);
                      return <option key={d} value={d}>{DAY_ABBR[dt.getDay()]} {dt.getMonth() + 1}/{dt.getDate()}</option>;
                    })}
                  </select>
                  <select value={req.kind} onChange={(e) => updateRequest(i, { kind: e.target.value as Request["kind"] })}>
                    <option value="all">all day</option>
                    <option value="day">day shift</option>
                    <option value="night">night shift</option>
                    <option value="custom">custom hours</option>
                  </select>
                  <button className="rowdrop" onClick={() => removeRequest(i)} title="Remove">×</button>
                </div>
                {req.kind === "custom" && (
                  <div className="reqtimes">
                    <input type="time" value={req.from} onChange={(e) => updateRequest(i, { from: e.target.value })} />
                    <span>to</span>
                    <input type="time" value={req.to} onChange={(e) => updateRequest(i, { to: e.target.value })} />
                    <span className="reqnote">
                      blocks: {expandRequests([req]).map((t) => `${t.shift} shift`).join(" + ") || "nothing yet"}
                    </span>
                  </div>
                )}
              </div>
            ))}
            <button className="addrow" onClick={addRequest}>+ Add request</button>
          </div>

          <button className="generate" onClick={generate}>Generate schedule</button>
        </div>

        <div className="result">
          {!result && (
            <div className="panel">
              <div className="empty">
                Set your roster and requests, then generate.<br />
                Every schedule is checked against every hard rule before it appears.
              </div>
            </div>
          )}

          {result && (result.status === "INVALID" || result.status === "INFEASIBLE") && (
            <div>
              <div className="sealbar">
                <span className="dot warn" />
                <span className="label">No valid schedule exists for these inputs</span>
              </div>
              {result.problems.map((p, i) => <div className="problem" key={i}>{p}</div>)}
              <div className="problem" style={{ borderColor: "var(--line)", color: "var(--ink-soft)", background: "var(--card)" }}>
                Quick math: the week holds {capacity.needed} shifts. Your minimums claim {capacity.minS} and your
                maximums allow {capacity.maxS}. Requests off shrink what is possible further. Adjust and generate again.
              </div>
            </div>
          )}

          {result && result.status === "OK" && cfgUsed && (
            <ResultView cfg={cfgUsed} result={result} colorIndex={colorIndex} weekStart={weekStart}
              requests={requests} />
          )}
        </div>
      </div>
    </div>
  );
}

function ResultView({
  cfg, result, colorIndex, weekStart, requests,
}: {
  cfg: Config;
  result: Extract<ReturnType<typeof solve>, { status: "OK" }>;
  colorIndex: Record<string, number>;
  weekStart: string;
  requests: Request[];
}) {
  const { sol } = result;
  const stats = summarize(cfg, sol);
  const idOf = (e: number) => cfg.staff[e].id;

  const grid: string[][][] = [];
  for (let d = 0; d < DAYS; d++) {
    grid[d] = [[], []];
    for (let s = 0; s < 2; s++) {
      for (let e = 0; e < cfg.staff.length; e++) {
        if (sol.assign[e][d][s]) grid[d][s].push(idOf(e));
      }
    }
  }
  const allCovered = grid.every((day) => day.every((slot) => slot.length === cfg.staffPerShift));

  const chip = (id: string) => (
    <span className="chip" key={id} style={{ background: colorFor(colorIndex[id] ?? 0) }}>{id}</span>
  );

  return (
    <div>
      <div className="sealbar">
        <span className={`dot ${allCovered ? "good" : "warn"}`} />
        <span className="label">
          {allCovered ? "Coverage verified · two on every shift, all week" : "Coverage gap detected"}
        </span>
        <span className="sub">
          best of {result.feasible.toLocaleString()} valid schedules
        </span>
      </div>

      <div className="band">
        <table>
          <thead>
            <tr>
              <th style={{ width: 92 }}></th>
              {Array.from({ length: DAYS }).map((_, d) => {
                const dt = addDays(weekStart, d);
                return (
                  <th key={d}>
                    {DAY_ABBR[dt.getDay()]}
                    <span className="date">{dt.getMonth() + 1}/{dt.getDate()}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="rowhead">
                <span className="k">Day</span>
                <span className="t">8 AM–8 PM</span>
              </td>
              {grid.map((day, d) => <td className="slot" key={d}>{day[0].map(chip)}</td>)}
            </tr>
            <tr>
              <td className="rowhead">
                <span className="k">Night</span>
                <span className="t">8 PM–8 AM</span>
              </td>
              {grid.map((day, d) => <td className="slot" key={d}>{day[1].map(chip)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      {requests.length > 0 && (
        <div className="honored">
          Honored requests: {requests.map((r, i) => {
            const dt = addDays(weekStart, r.day);
            const when = r.kind === "custom" ? `${fmtClock(r.from)}–${fmtClock(r.to)}` : r.kind === "all" ? "all day" : r.kind + " shift";
            return <span key={i}>{r.id} out {DAY_ABBR[dt.getDay()]} {dt.getMonth() + 1}/{dt.getDate()} ({when}){i < requests.length - 1 ? " · " : ""}</span>;
          })}
        </div>
      )}

      <div className="ledger">
        <h3>Hours Ledger</h3>
        <table>
          <thead>
            <tr>
              <th>Staff</th><th>Hours</th><th>Target</th><th>Nights</th><th>Weekend shifts</th>
            </tr>
          </thead>
          <tbody>
            {cfg.staff.map((s, i) => {
              const h = stats.hours[s.id];
              const hit = h >= s.min && h <= s.max;
              return (
                <tr key={i}>
                  <td className="id"><span className="sw" style={{ background: colorFor(i) }} />{s.id}</td>
                  <td className={hit ? "hit" : "miss"}>{h} h</td>
                  <td>{s.pref} h</td>
                  <td>{stats.nights[s.id]}</td>
                  <td>{stats.weekends[s.id]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="tools">
        <button onClick={() => window.print()}>Print or save PDF</button>
      </div>
    </div>
  );
}
