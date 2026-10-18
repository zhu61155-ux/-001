/**
 * model.js — 课程表数据模型（纯逻辑，无 DOM 依赖）
 * 周次/单双周、学期日期计算、冲突检测、ICS(iCalendar) 生成、调色板。
 * 浏览器中以全局对象 ScheduleModel 暴露；Node 中通过 module.exports 暴露。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScheduleModel = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const pad2 = n => String(n).padStart(2, "0");

  /** 常见节次时间表（12 节，可自定义） */
  const DEFAULT_PERIOD_TIMES = [
    { start: "08:00", end: "08:45" },
    { start: "08:55", end: "09:40" },
    { start: "10:00", end: "10:45" },
    { start: "10:55", end: "11:40" },
    { start: "14:00", end: "14:45" },
    { start: "14:55", end: "15:40" },
    { start: "16:00", end: "16:45" },
    { start: "16:55", end: "17:40" },
    { start: "19:00", end: "19:45" },
    { start: "19:55", end: "20:40" },
    { start: "20:50", end: "21:35" },
    { start: "21:45", end: "22:30" }
  ];

  const DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const DAY_SHORT = ["一", "二", "三", "四", "五", "六", "日"];
  const BYDAY = [null, "MO", "TU", "WE", "TH", "FR", "SA", "SU"];

  const PALETTE = [
    "#4f7cff", "#0ca678", "#f59f00", "#e64980", "#8b5cf6", "#2f9e44",
    "#f03e3e", "#0b7285", "#e8890c", "#5c7cfa", "#b23cfd", "#12b886"
  ];

  // ---------------- 日期 ----------------

  function parseDate(str) {
    const parts = String(str).split("-").map(Number);
    return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
  }
  function fmtDate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function dayDiff(a, b) { return Math.round((b - a) / 86400000); } // 两个零点日期相差天数
  function toMidnight(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

  // ---------------- 周次 ----------------

  /** ranges 为 null/空 → 全学期；否则需落在区间内且单双周匹配 */
  function weeksMatch(ranges, parity, week) {
    if (!ranges || !ranges.length) return true;
    if (parity === "odd" && week % 2 === 0) return false;
    if (parity === "even" && week % 2 === 1) return false;
    return ranges.some(r => week >= r.start && week <= r.end);
  }

  function expandWeeks(ranges, parity, totalWeeks) {
    const out = [];
    for (let w = 1; w <= totalWeeks; w++) {
      if (weeksMatch(ranges, parity, w)) out.push(w);
    }
    return out;
  }

  function mergeRangeLists(a, b) {
    const all = [...a, ...b].map(r => ({ start: r.start, end: r.end }))
      .sort((x, y) => x.start - y.start || x.end - y.end);
    const out = [];
    for (const r of all) {
      const last = out[out.length - 1];
      if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
      else out.push({ ...r });
    }
    return out;
  }

  function formatWeeks(ranges, parity, totalWeeks) {
    if (!ranges || !ranges.length) return "全学期（1-" + totalWeeks + "周）";
    const segs = ranges.map(r => (r.start === r.end ? String(r.start) : r.start + "-" + r.end));
    let s = segs.join(",") + "周";
    if (parity === "odd") s += "（单周）";
    if (parity === "even") s += "（双周）";
    return s;
  }

  /** 今天是第几周（<1 未开学，>totalWeeks 已放假） */
  function weekOf(today, semesterStart) {
    const s = parseDate(semesterStart);
    return Math.floor(dayDiff(s, toMidnight(today)) / 7) + 1;
  }

  /** 指定周次的每天日期 */
  function weekDates(semesterStart, week) {
    const s = parseDate(semesterStart);
    const out = [];
    for (let d = 1; d <= 7; d++) {
      const date = addDays(s, (week - 1) * 7 + (d - 1));
      out.push({ day: d, date, dateStr: fmtDate(date) });
    }
    return out;
  }

  function semesterEndStr(semesterStart, totalWeeks) {
    return fmtDate(addDays(parseDate(semesterStart), totalWeeks * 7 - 1));
  }

  /** 找最近的周一（用于默认开学日期） */
  function lastMonday(d) {
    const x = toMidnight(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }

  // ---------------- 冲突检测 ----------------

  /**
   * 检测指定周的课程冲突：同一天、节次区间重叠且当周都要上课
   * 返回 [{ day, a, b }]
   */
  function findConflicts(sessions, week) {
    const out = [];
    const byDay = {};
    for (const s of sessions) {
      if (!weeksMatch(s.weekRanges, s.parity, week)) continue;
      (byDay[s.day] = byDay[s.day] || []).push(s);
    }
    for (const day of Object.keys(byDay)) {
      const list = byDay[day].sort((a, b) => a.startPeriod - b.startPeriod);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[j].startPeriod <= list[i].endPeriod) {
            out.push({ day: +day, a: list[i], b: list[j] });
          } else break;
        }
      }
    }
    return out;
  }

  // ---------------- ICS (iCalendar) 导出 ----------------

  function escapeICS(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/,/g, "\\,")
      .replace(/;/g, "\\;").replace(/\r?\n/g, "\\n");
  }

  /**
   * 生成 .ics 文件内容（本地浮动时间，各大日历 App 可直接导入）
   * 单双周 → INTERVAL=2；中间缺的周 → EXDATE。
   */
  function buildICS(sessions, settings) {
    const total = settings.totalWeeks || 20;
    const start = parseDate(settings.semesterStart);
    const L = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//CourseScheduleApp//ZH-CN",
      "CALSCALE:GREGORIAN"
    ];
    let n = 0;
    for (const s of sessions) {
      const weeks = expandWeeks(s.weekRanges, s.parity, total);
      if (!weeks.length) continue;
      const t0 = settings.periodTimes[s.startPeriod - 1];
      const t1 = settings.periodTimes[s.endPeriod - 1];
      if (!t0 || !t1) continue;
      const [h0, m0] = t0.start.split(":").map(Number);
      const [h1, m1] = t1.end.split(":").map(Number);
      const first = addDays(start, (weeks[0] - 1) * 7 + (s.day - 1));
      const last = addDays(start, (weeks[weeks.length - 1] - 1) * 7 + (s.day - 1));
      const dtStart = fmtDate(first) + "T" + pad2(h0) + pad2(m0) + "00";
      const dtEnd = fmtDate(first) + "T" + pad2(h1) + pad2(m1) + "00";
      const until = fmtDate(last) + "T" + pad2(h1) + pad2(m1) + "00";
      const interval = (s.parity === "odd" || s.parity === "even") ? 2 : 1;
      const missing = [];
      for (let w = weeks[0]; w <= weeks[weeks.length - 1]; w++) {
        if (!weeks.includes(w)) missing.push(w);
      }
      n++;
      L.push("BEGIN:VEVENT");
      L.push("UID:csa-" + n + "-" + (s.id || "x") + "@course-schedule.local");
      L.push("DTSTAMP:" + dtStart);
      L.push("DTSTART:" + dtStart);
      L.push("DTEND:" + dtEnd);
      L.push("RRULE:FREQ=WEEKLY;INTERVAL=" + interval + ";BYDAY=" + BYDAY[s.day] + ";UNTIL=" + until);
      for (const w of missing) {
        const d = addDays(start, (w - 1) * 7 + (s.day - 1));
        L.push("EXDATE:" + fmtDate(d) + "T" + pad2(h0) + pad2(m0) + "00");
      }
      const desc = ["课程：" + s.name];
      if (s.teacher) desc.push("教师：" + s.teacher);
      if (s.location) desc.push("教室：" + s.location);
      desc.push("周次：" + formatWeeks(s.weekRanges, s.parity, total));
      L.push("SUMMARY:" + escapeICS(s.name));
      L.push("DESCRIPTION:" + escapeICS(desc.join("\n")));
      if (s.location) L.push("LOCATION:" + escapeICS(s.location));
      L.push("END:VEVENT");
    }
    L.push("END:VCALENDAR");
    return L.join("\r\n") + "\r\n";
  }

  // ---------------- 颜色 ----------------

  function colorFor(str) {
    let h = 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  return {
    pad2, DEFAULT_PERIOD_TIMES, DAY_NAMES, DAY_SHORT, BYDAY, PALETTE,
    parseDate, fmtDate, addDays, dayDiff, toMidnight,
    weeksMatch, expandWeeks, mergeRangeLists, formatWeeks,
    weekOf, weekDates, semesterEndStr, lastMonday,
    findConflicts, buildICS, escapeICS, colorFor
  };
});
