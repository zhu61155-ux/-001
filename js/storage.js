/**
 * storage.js — 本地持久化（localStorage，附带内存兜底）
 * 数据全部保存在本机浏览器里，不会上传到任何服务器。
 */
(function (root) {
  "use strict";
  const KEY = "courseScheduleApp.v1";

  function uid() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function defaultState() {
    const M = root.ScheduleModel;
    return {
      settings: {
        semesterName: "",
        semesterStart: M.fmtDate(M.lastMonday(new Date())), // 默认：本周所在周一
        totalWeeks: 20,
        periodTimes: JSON.parse(JSON.stringify(M.DEFAULT_PERIOD_TIMES)),
        showWeekends: true
      },
      courses: [],   // { id, name, teacher, location, color }
      sessions: []   // { id, courseId, day, startPeriod, endPeriod, weekRanges, parity }
    };
  }

  function normalize(state) {
    const d = defaultState();
    if (!state || typeof state !== "object") return d;
    const s = state;
    const out = {
      settings: Object.assign({}, d.settings, s.settings || {}),
      courses: Array.isArray(s.courses) ? s.courses : [],
      sessions: Array.isArray(s.sessions) ? s.sessions : []
    };
    if (!Array.isArray(out.settings.periodTimes) || !out.settings.periodTimes.length) {
      out.settings.periodTimes = d.settings.periodTimes;
    }
    for (const c of out.courses) {
      if (!c.id) c.id = uid();
      if (!c.color) c.color = root.ScheduleModel.colorFor(c.name);
    }
    for (const x of out.sessions) {
      if (!x.id) x.id = uid();
      if (!x.parity) x.parity = "all";
      if (x.weekRanges && !Array.isArray(x.weekRanges)) x.weekRanges = null;
    }
    return out;
  }

  let memory = null; // localStorage 不可用时（如某些 file:// 环境）的内存兜底
  let usable = true;
  try {
    localStorage.setItem("__csa_test__", "1");
    localStorage.removeItem("__csa_test__");
  } catch (e) {
    usable = false;
  }

  function loadState() {
    if (!usable) return memory || (memory = defaultState());
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      return normalize(JSON.parse(raw));
    } catch (e) {
      return defaultState();
    }
  }

  function saveState(state) {
    const out = normalize(state);
    if (usable) {
      try { localStorage.setItem(KEY, JSON.stringify(out)); } catch (e) { /* 忽略 */ }
    } else {
      memory = out;
    }
    return out;
  }

  function clearState() {
    if (usable) {
      try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
    }
    memory = null;
  }

  root.ScheduleStore = {
    KEY, uid, defaultState, normalize, loadState, saveState, clearState,
    persistent: function () { return usable; }
  };
})(typeof self !== "undefined" ? self : this);
