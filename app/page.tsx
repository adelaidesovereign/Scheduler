"use client";

import { useMemo, useState } from "react";
import { solve, summarize, DAYS } from "@/lib/solver";
import { Config, Lean, Staff, TimeOff, ShiftName } from "@/lib/types";

const PALETTE = [
  "#F4C6DA", "#D8C6F0", "#FBE39A", "#F7CB98", "#F4A6A6", "#9BE5EE",
  "#BFE0F6", "#F3E4B4", "#C9E7BC", "#F1B9CA", "#C9D6F0", "#E8D2B2",
];
const colorFor = (i: number) => PALETTE[i % PALETTE.length];

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const START_ROSTER: Staff[] = [
  { id: "CT", pref: 36, min: 24, max: 48, lean: "day" },
  { id: "CM", pref: 24, min: 12, max: 36, lean: "day" },
  { id: "AT", pref: 36, min: 24, max: 48, lean: "day" },
  { id: "AD", pref: 36, min: 24, max: 48, lean: "any" },
  { id: "KH", pref: 24, min: 12, max: 36, lean: "day" },
  { id: "EH", pref: 36, min: 24, max: 48, lean: "night" },
  { id: "SL", pref: 36, min: 24, max: 48, lean: "night" },
  { id: "WR", pref: 36, min: 24, max: 48, lean: "night" },
  { id: "VT", pref: 24, min: 12, max: 36, lean: "night" },
  { id: "R1", pref: 24, min: 12, max: 36, lean: "any" },
  { id: "R2", pref: 24, min: 12, max: 36, lean: "any" },
  { id: "R3", pref: 24, min: 12, max: 36, lean: "any" },
];

function fmtHour(h: number): string {
  const suffix = h < 12 || h === 24 ? "AM" : "PM";
  let base = h % 12;
  if (base === 0) base = 12;
  return `${base} ${suffix}`;
}

function addDays(iso: string, n: number): Date {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d;
}

export default function Page() {
  const [weekStart, setWeekStart] = useState("2026-06-05");
  const [pivot, setPivot] = useState<8 | 9>(8);
  const [staff, setStaff] = useState<Staff[]>(START_ROSTER);
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [result, setResult] = useState<ReturnType<typeof solve> | null>(null);
  const [cfgUsed, setCfgUsed] = useState<Config | null>(null);

  const dayStart = pivot;
  const nightStart = pivot + 12;

  const startDow = useMemo(() => new Date(weekStart + "T00:00:00").getDay(), [weekStart]);
  // weekend indices relative to week start (Sat and Sun)
  const weekendDays = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < DAYS; i++) {
      const dow = (startDow + i) % 7;
      if (dow === 0 || dow === 6) out.push(i);
    }
    return out;
  }, [startDow]);

  function updateStaff(i: number, patch: Partial<Staff>) {
    setStaff((s) => s.map((row, k) => (k === i ? { ...row, ...patch } : row)));
  }
  function removeStaff(i: number) {
    setStaff((s) => s.filter((_, k) => k !== i));
  }
  function addStaff() {
    setStaff((s) => [...s, { id: "NEW", pref: 24, min: 12, max: 36, lean: "any" }]);
  }
  function addRequest() {
    setTimeOff((t) => [...t, { id: staff[0]?.id || "", day: 0, shift: "all" }]);
  }
  function updateRequest(i: number, patch: Partial<TimeOff>) {
    setTimeOff((t) => t.map((row, k) => (k === i ? { ...row, ...patch } : row)));
  }
  function removeRequest(i: number) {
    setTimeOff((t) => t.filter((_, k) => k !== i));
  }

  function generate() {
    const cfg: Config = {
      staff,
      dayStartHour: dayStart,
      nightStartHour: nightStart,
      shiftLengthHours: 12,
      staffPerShift: 2,
      timeOff,
      locked: [],
      weights: { hours: 100, night: 8, weekend: 6, lean: 4 },
      weekendDays,
      seed: Math.floor(Math.random() * 1e9),
    };
    setCfgUsed(cfg);
    setResult(solve(cfg, 300));
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
          two on the floor · {fmtHour(dayStart)} to {fmtHour(nightStart)} · {fmtHour(nightStart)} to {fmtHour(dayStart)}
        </div>
      </div>
      <div className="hairline" />

      <div className="layout">
        {/* CONTROLS */}
        <div>
          <div className="panel">
            <h2>Week</h2>
            <div className="field">
              <label>Week starts</label>
              <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
            </div>
            <div className="field">
              <label>Shift pivot</label>
              <div className="pivot">
                <button className={pivot === 8 ? "on" : ""} onClick={() => setPivot(8)}>8 &amp; 8</button>
                <button className={pivot === 9 ? "on" : ""} onClick={() => setPivot(9)}>9 &amp; 9</button>
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>Roster · Weekly Hours</h2>
            <table className="roster">
              <thead>
                <tr>
                  <th></th>
                  <th>ID</th>
                  <th>Pref</th>
                  <th>Min</th>
                  <th>Max</th>
                  <th>Lean</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {staff.map((row, i) => (
                  <tr key={i}>
                    <td><span className="swatch" style={{ background: colorFor(i) }} /></td>
                    <td className="idcell" style={{ width: 42 }}>
                      <input type="text" value={row.id} maxLength={4}
                        onChange={(e) => updateStaff(i, { id: e.target.value.toUpperCase() })} />
                    </td>
                    <td style={{ width: 50 }}>
                      <input type="number" value={row.pref} step={12} min={0}
                        onChange={(e) => updateStaff(i, { pref: +e.target.value })} />
                    </td>
                    <td style={{ width: 50 }}>
                      <input type="number" value={row.min} step={12} min={0}
                        onChange={(e) => updateStaff(i, { min: +e.target.value })} />
                    </td>
                    <td style={{ width: 50 }}>
                      <input type="number" value={row.max} step={12} min={0}
                        onChange={(e) => updateStaff(i, { max: +e.target.value })} />
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
          </div>

          <div className="panel">
            <h2>Time Off Requests</h2>
            {timeOff.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 10px" }}>
                None yet. Add a request to hold a slot open for someone.
              </p>
            )}
            {timeOff.map((req, i) => (
              <div className="reqrow" key={i}>
                <select value={req.id} onChange={(e) => updateRequest(i, { id: e.target.value })}>
                  {staff.map((s, k) => <option key={k} value={s.id}>{s.id}</option>)}
                </select>
                <select value={req.day} onChange={(e) => updateRequest(i, { day: +e.target.value })}>
                  {Array.from({ length: DAYS }).map((_, d) => {
                    const dt = addDays(weekStart, d);
                    return <option key={d} value={d}>{DAY_ABBR[dt.getDay()]} {dt.getMonth() + 1}/{dt.getDate()}</option>;
                  })}
                </select>
                <select value={req.shift} onChange={(e) => updateRequest(i, { shift: e.target.value as ShiftName })}>
                  <option value="all">all day</option>
                  <option value="day">day only</option>
                  <option value="night">night only</option>
                </select>
                <button className="rowdrop" onClick={() => removeRequest(i)} title="Remove">×</button>
              </div>
            ))}
            <button className="addrow" onClick={addRequest}>+ Add request</button>
          </div>

          <button className="generate" onClick={generate}>Generate schedule</button>
        </div>

        {/* RESULT */}
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
                <span className="label">No schedule produced</span>
              </div>
              {result.problems.map((p, i) => <div className="problem" key={i}>{p}</div>)}
            </div>
          )}

          {result && result.status === "OK" && cfgUsed && (
            <ResultView cfg={cfgUsed} result={result} colorIndex={colorIndex} weekStart={weekStart}
              dayStart={dayStart} nightStart={nightStart} />
          )}
        </div>
      </div>
    </div>
  );
}

function ResultView({
  cfg, result, colorIndex, weekStart, dayStart, nightStart,
}: {
  cfg: Config;
  result: Extract<ReturnType<typeof solve>, { status: "OK" }>;
  colorIndex: Record<string, number>;
  weekStart: string;
  dayStart: number;
  nightStart: number;
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
          {result.attempts.toLocaleString()} schedules tried · best of {result.feasible.toLocaleString()} valid
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
                <span className="t">{fmtHour(dayStart)}–{fmtHour(nightStart)}</span>
              </td>
              {grid.map((day, d) => <td className="slot" key={d}>{day[0].map(chip)}</td>)}
            </tr>
            <tr>
              <td className="rowhead">
                <span className="k">Night</span>
                <span className="t">{fmtHour(nightStart)}–{fmtHour(dayStart)}</span>
              </td>
              {grid.map((day, d) => <td className="slot" key={d}>{day[1].map(chip)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="ledger">
        <h3>Hours Ledger</h3>
        <table>
          <thead>
            <tr>
              <th>Staff</th>
              <th>Hours</th>
              <th>Target</th>
              <th>Nights</th>
              <th>Weekend shifts</th>
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
