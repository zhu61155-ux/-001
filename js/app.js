/**
 * app.js — 应用主逻辑：状态管理、视图渲染、导入/导出、设置、课程编辑
 */
(function () {
  "use strict";
  const M = window.ScheduleModel;
  const P = window.ScheduleParser;
  const S = window.ScheduleStore;
  const U = window.UI;

  const ROW_H = 56; // 每节高度(px)

  let state = S.loadState();
  let viewWeek = computeViewWeek();
  let query = "";
  let pendingImport = null; // { sessions } 等待确认的导入结果
  let currentView = "grid"; // "grid" | "list"

  // ---------------- 基础工具 ----------------

  function currentWeek() {
    return M.weekOf(new Date(), state.settings.semesterStart);
  }
  function computeViewWeek() {
    const w = currentWeek();
    const t = state.settings.totalWeeks || 1;
    return Math.min(Math.max(w, 1), t);
  }
  function save() { state = S.saveState(state); }
  function courseOf(session) {
    return state.courses.find(c => c.id === session.courseId) || {
      name: "未知课程", teacher: "", location: "", color: "#888"
    };
  }
  function sessionsForWeek(week) {
    return state.sessions.filter(s => M.weeksMatch(s.weekRanges, s.parity, week));
  }
  function matchesQuery(course, session) {
    if (!query) return true;
    const q = query.toLowerCase();
    return (course.name + course.teacher + course.location).toLowerCase().includes(q);
  }
  function hexA(hex, alpha) {
    const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex + a : "#888888" + a;
  }
  function periodLabel(i) {
    const p = state.settings.periodTimes[i];
    return p ? p.start + "–" + p.end : "第" + (i + 1) + "节";
  }
  function conflictIdSet(week) {
    const set = new Set();
    for (const c of M.findConflicts(state.sessions, week)) {
      set.add(c.a.id); set.add(c.b.id);
    }
    return set;
  }

  // ---------------- 渲染 ----------------

  function render() {
    const nCourses = state.courses.length;
    document.getElementById("emptyState").classList.toggle("hidden", nCourses > 0);
    document.getElementById("gridScroll").classList.toggle("hidden", nCourses === 0 || currentView !== "grid");
    document.getElementById("listView").classList.toggle("hidden", nCourses === 0 || currentView !== "list");
    document.getElementById("listCount").classList.toggle("hidden", nCourses === 0 || currentView !== "list");

    renderHeader();
    renderGrid();
    renderList();
    renderStats();
    renderPrintHeader();

    document.getElementById("viewGridBtn").classList.toggle("on", currentView === "grid");
    document.getElementById("viewListBtn").classList.toggle("on", currentView === "list");
  }

  function renderHeader() {
    const w = currentWeek();
    const t = state.settings.totalWeeks;
    const badge = document.getElementById("semesterBadge");
    const st = state.settings.semesterStart;
    const en = M.semesterEndStr(st, t);
    let status = "";
    if (w < 1) status = " · 未开学";
    else if (w > t) status = " · 已放假";
    badge.textContent = (state.settings.semesterName ? state.settings.semesterName + " · " : "") + st + " ~ " + en + status;
    document.getElementById("weekNum").textContent = "第 " + viewWeek + " 周";
    document.getElementById("weekRange").textContent = "共 " + t + " 周";
    document.getElementById("btnToday").classList.toggle("accent", viewWeek === w);
  }

  function renderPrintHeader() {
    const el = document.getElementById("printHeader");
    const st = state.settings.semesterStart;
    const en = M.semesterEndStr(st, state.settings.totalWeeks);
    el.textContent = "课程表（" + (state.settings.semesterName || "本学期") + " · " + st + " ~ " + en + " · 第 " + viewWeek + " 周）";
  }

  function renderGrid() {
    const wrap = document.getElementById("gridWrap");
    const n = state.settings.periodTimes.length;
    const days = state.settings.showWeekends ? 7 : 5;
    wrap.innerHTML = "";
    wrap.style.setProperty("--days", String(days));
    wrap.style.setProperty("--periods", String(n));

    const grid = U.el("div", { class: "grid" });
    grid.appendChild(U.el("div", { class: "corner" }, "节次＼星期"));

    const dates = M.weekDates(state.settings.semesterStart, viewWeek);
    const todayStr = M.fmtDate(new Date());
    const isCurWeek = viewWeek === currentWeek();

    for (let d = 1; d <= days; d++) {
      const dt = dates[d - 1];
      const today = isCurWeek && dt.dateStr === todayStr;
      grid.appendChild(U.el("div", {
        class: "day-head" + (today ? " today" : ""),
        style: { gridColumn: String(d + 1), gridRow: "1" }
      },
        U.el("div", { class: "day-name" }, M.DAY_NAMES[d - 1]),
        U.el("div", { class: "day-date" }, (dt.date.getMonth() + 1) + "/" + dt.date.getDate())
      ));
    }

    for (let i = 0; i < n; i++) {
      grid.appendChild(U.el("div", {
        class: "time-label",
        style: { gridColumn: "1", gridRow: String(i + 2) }
      },
        U.el("div", { class: "tl-no" }, "第" + (i + 1) + "节"),
        U.el("div", { class: "tl-time" }, periodLabel(i))
      ));
    }

    const sessions = sessionsForWeek(viewWeek);
    const conflicts = conflictIdSet(viewWeek);

    for (let d = 1; d <= days; d++) {
      const dt = dates[d - 1];
      const today = isCurWeek && dt.dateStr === todayStr;
      const track = U.el("div", {
        class: "day-track" + (today ? " today" : ""),
        style: { gridColumn: String(d + 1), gridRow: "2 / -1", height: n * ROW_H + "px" }
      });
      const daySessions = sessions.filter(s => s.day === d).sort((a, b) => a.startPeriod - b.startPeriod);
      for (const s of daySessions) {
        const course = courseOf(s);
        const span = Math.max(1, s.endPeriod - s.startPeriod + 1);
        const top = Math.max(0, (s.startPeriod - 1) * ROW_H);
        const height = Math.min(span * ROW_H, n * ROW_H - top);
        const card = U.el("div", {
          class: "card" + (conflicts.has(s.id) ? " conflict" : "") + (matchesQuery(course, s) ? "" : " dimmed"),
          style: {
            top: top + 3 + "px",
            height: height - 6 + "px",
            background: hexA(course.color, 0.13),
            borderLeftColor: course.color
          },
          onclick: () => openEditModal(s.id),
          title: course.name + "｜" + [course.teacher, course.location].filter(Boolean).join(" · ") +
            "｜" + M.formatWeeks(s.weekRanges, s.parity, state.settings.totalWeeks)
        },
          U.el("div", { class: "card-name" }, course.name),
          U.el("div", { class: "card-sub" }, [course.teacher, course.location].filter(Boolean).join(" · ") || "—"),
          U.el("div", { class: "card-weeks" }, M.formatWeeks(s.weekRanges, s.parity, state.settings.totalWeeks)),
          conflicts.has(s.id) ? U.el("span", { class: "card-warn", title: "与其他课程时间冲突" }, "⚠") : null
        );
        track.appendChild(card);
      }
      grid.appendChild(track);
    }
    wrap.appendChild(grid);
  }

  function renderList() {
    const box = document.getElementById("listView");
    box.innerHTML = "";
    const dates = M.weekDates(state.settings.semesterStart, viewWeek);
    const sessions = sessionsForWeek(viewWeek);
    const conflicts = conflictIdSet(viewWeek);
    let total = 0;
    for (let d = 1; d <= 7; d++) {
      if (d > 5 && !state.settings.showWeekends) continue;
      const daySessions = sessions.filter(s => s.day === d).sort((a, b) => a.startPeriod - b.startPeriod);
      if (!daySessions.length) continue;
      const section = U.el("section", { class: "list-day" },
        U.el("h3", { class: "list-day-title" }, M.DAY_NAMES[d - 1] + " · " + (dates[d - 1].date.getMonth() + 1) + "/" + dates[d - 1].date.getDate())
      );
      for (const s of daySessions) {
        const course = courseOf(s);
        if (!matchesQuery(course, s)) continue;
        total++;
        const t0 = state.settings.periodTimes[s.startPeriod - 1];
        const t1 = state.settings.periodTimes[s.endPeriod - 1];
        const item = U.el("div", {
          class: "list-item" + (conflicts.has(s.id) ? " conflict" : ""),
          style: { borderLeftColor: course.color },
          onclick: () => openEditModal(s.id)
        },
          U.el("div", { class: "li-time" }, (t0 ? t0.start : "") + "–" + (t1 ? t1.end : "") +
            U.el("div", { class: "li-periods" }, "第" + s.startPeriod + (s.endPeriod > s.startPeriod ? "-" + s.endPeriod : "") + "节")),
          U.el("div", { class: "li-main" },
            U.el("div", { class: "li-name" }, course.name + (conflicts.has(s.id) ? " ⚠" : "")),
            U.el("div", { class: "li-sub" }, [course.teacher, course.location].filter(Boolean).join(" · ") || "—")),
          U.el("div", { class: "li-weeks" }, M.formatWeeks(s.weekRanges, s.parity, state.settings.totalWeeks))
        );
        section.appendChild(item);
      }
      box.appendChild(section);
    }
    document.getElementById("listCount").textContent = total ? "本周共 " + total + " 节课" : "本周无课程";
  }

  function renderStats() {
    const week = viewWeek;
    const weekCount = sessionsForWeek(week).length;
    const conf = M.findConflicts(state.sessions, week).length;
    const parts = [];
    parts.push(state.courses.length + " 门课");
    parts.push(state.sessions.length + " 条排课");
    parts.push("本周 " + weekCount + " 节");
    if (conf) parts.push("⚠ 冲突 " + conf);
    document.getElementById("statLine").textContent = parts.join(" · ");
  }

  // ---------------- 课程编辑弹窗 ----------------

  function openEditModal(sessionId) {
    const n = state.settings.periodTimes.length;
    const session = sessionId ? state.sessions.find(s => s.id === sessionId) : null;
    const course = session ? courseOf(session) : { name: "", teacher: "", location: "", color: M.colorFor("") };
    const isEdit = !!session;

    const dayOpts = M.DAY_NAMES.map((nm, i) =>
      "<option value='" + (i + 1) + "'" + (session && session.day === i + 1 ? " selected" : "") + ">" + nm + "</option>").join("");
    const periodOpts = (sel) => {
      let h = "";
      for (let i = 1; i <= n; i++) {
        h += "<option value='" + i + "'" + (sel === i ? " selected" : "") + ">第" + i + "节 " + periodLabel(i - 1) + "</option>";
      }
      return h;
    };
    const swatches = M.PALETTE.map(c =>
      "<span class='swatch' data-c='" + c + "' style='background:" + c + "' title='" + c + "'></span>").join("");
    const weeksText = session && session.weekRanges
      ? session.weekRanges.map(r => r.start === r.end ? String(r.start) : r.start + "-" + r.end).join(",")
      : "";
    const parity = session ? (session.parity || "all") : "all";

    const bodyHtml =
      "<div class='form'>" +
      "<label>课程名称 *<input id='fName' value='" + U.esc(course.name) + "' placeholder='如：高等数学A'></label>" +
      "<div class='form-row'>" +
      "<label>教师<input id='fTeacher' value='" + U.esc(course.teacher) + "' placeholder='选填'></label>" +
      "<label>教室 / 地点<input id='fLocation' value='" + U.esc(course.location) + "' placeholder='选填'></label>" +
      "</div>" +
      "<div class='form-row'>" +
      "<label>星期<select id='fDay'>" + dayOpts + "</select></label>" +
      "<label>开始节次<select id='fStart'>" + periodOpts(session ? session.startPeriod : 1) + "</select></label>" +
      "<label>结束节次<select id='fEnd'>" + periodOpts(session ? session.endPeriod : 2) + "</select></label>" +
      "</div>" +
      "<label>周次（留空 = 全学期）<input id='fWeeks' value='" + U.esc(weeksText) + "' placeholder='如：1-16 或 1-8,10-16'></label>" +
      "<div class='form-row parity-row'>" +
      "<label>单双周</label>" +
      "<label class='radio'><input type='radio' name='fParity' value='all'" + (parity === "all" ? " checked" : "") + "> 全部</label>" +
      "<label class='radio'><input type='radio' name='fParity' value='odd'" + (parity === "odd" ? " checked" : "") + "> 单周</label>" +
      "<label class='radio'><input type='radio' name='fParity' value='even'" + (parity === "even" ? " checked" : "") + "> 双周</label>" +
      "</div>" +
      "<div class='form-row color-row'><label>颜色</label><div id='fColors'>" + swatches +
      "<span class='swatch auto' data-c='' title='自动配色'>🎲</span></div></div>" +
      "</div>";

    const m = U.modal({
      title: isEdit ? "编辑课程" : "添加课程",
      bodyHtml,
      footerHtml:
        (isEdit ? "<button class='btn danger' id='fDelete'>删除</button>" : "") +
        "<span class='spacer'></span>" +
        "<button class='btn' id='fCancel'>取消</button>" +
        "<button class='btn primary' id='fSave'>保存</button>"
    });
    const b = m.body;
    const foot = m.card.querySelector(".modal-foot");

    let colorVal = course.color;
    b.querySelectorAll(".swatch").forEach(sw => {
      sw.classList.toggle("on", sw.dataset.c === course.color);
      sw.onclick = () => {
        colorVal = sw.dataset.c;
        b.querySelectorAll(".swatch").forEach(x => x.classList.toggle("on", x === sw));
      };
    });

    foot.querySelector("#fCancel").onclick = () => m.close();
    if (isEdit) {
      foot.querySelector("#fDelete").onclick = async () => {
        const ok = await U.confirmDialog("删除课程", "确定删除「" + course.name + "」的这条排课吗？", true);
        if (!ok) return;
        state.sessions = state.sessions.filter(s => s.id !== sessionId);
        if (!state.sessions.some(s => s.courseId === course.id)) {
          state.courses = state.courses.filter(c => c.id !== course.id);
        }
        save(); render(); m.close();
        U.toast("已删除", "success");
      };
    }
    foot.querySelector("#fSave").onclick = () => {
      const name = b.querySelector("#fName").value.trim();
      const teacher = b.querySelector("#fTeacher").value.trim();
      const location = b.querySelector("#fLocation").value.trim();
      const day = +b.querySelector("#fDay").value;
      const startPeriod = +b.querySelector("#fStart").value;
      const endPeriod = +b.querySelector("#fEnd").value;
      const parity = (b.querySelector("input[name='fParity']:checked") || {}).value || "all";
      const weeksRaw = b.querySelector("#fWeeks").value.trim();

      if (!name) { U.toast("请填写课程名称", "error"); return; }
      if (endPeriod < startPeriod) { U.toast("结束节次不能早于开始节次", "error"); return; }
      let weekRanges = null;
      if (weeksRaw) {
        const w = P.parseWeekExpr(weeksRaw);
        if (!w) { U.toast("周次格式不正确，示例：1-16 或 1-8,10-16", "error"); return; }
        weekRanges = w.ranges;
      }
      const color = colorVal || M.colorFor(name);

      if (isEdit) {
        const c = courseOf(session);
        c.name = name; c.teacher = teacher; c.location = location; c.color = color;
        session.day = day; session.startPeriod = startPeriod; session.endPeriod = endPeriod;
        session.weekRanges = weekRanges; session.parity = parity;
        U.toast("已保存", "success");
      } else {
        const course = { id: S.uid(), name, teacher, location, color };
        state.courses.push(course);
        state.sessions.push({
          id: S.uid(), courseId: course.id, day, startPeriod, endPeriod,
          weekRanges, parity
        });
        U.toast("已添加课程", "success");
      }
      save(); render(); m.close();
    };
  }

  // ---------------- 导入 ----------------

  function showImportPreview(sessions) {
    const box = document.getElementById("impPreview");
    if (!sessions.length) {
      box.innerHTML = "<p class='muted'>没有解析出任何课程。</p>";
      return;
    }
    const rows = sessions.map(s =>
      "<tr><td>" + U.esc(s.name) + "</td><td>" + U.esc(s.teacher) + "</td><td>" + U.esc(s.location) + "</td>" +
      "<td>" + M.DAY_NAMES[s.day - 1] + "</td><td>第" + s.startPeriod + (s.endPeriod > s.startPeriod ? "-" + s.endPeriod : "") + "节</td>" +
      "<td>" + U.esc(M.formatWeeks(s.weekRanges, s.parity, state.settings.totalWeeks)) + "</td></tr>").join("");
    box.innerHTML =
      "<div class='preview-info'>共解析出 <b>" + sessions.length + "</b> 条排课：</div>" +
      "<div class='preview-scroll'><table class='preview-table'><thead><tr>" +
      "<th>课程</th><th>教师</th><th>地点</th><th>星期</th><th>节次</th><th>周次</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>";
  }

  function openImportModal() {
    pendingImport = null;
    const m = U.modal({
      title: "导入课表",
      wide: true,
      bodyHtml:
        "<div class='tabs'>" +
        "<button class='tab-btn on' data-tab='html'>① 粘贴课表 HTML</button>" +
        "<button class='tab-btn' data-tab='excel'>② 上传 Excel</button>" +
        "<button class='tab-btn' data-tab='json'>③ 恢复备份</button>" +
        "</div>" +
        "<div class='tab-pane' id='pane-html'>" +
        "<p class='muted'>在教务系统打开「我的课表 / 课表查询」页面后：浏览器中按 <b>Ctrl+U</b>（或右键 → 查看网页源代码），全选复制，粘贴到下面；也可以只复制课表 <code>&lt;table&gt;</code> 片段。</p>" +
        "<textarea id='impHtml' rows='8' placeholder='把课表页面的 HTML 源码粘贴到这里…'></textarea>" +
        "<div class='hint-row'><button class='btn ghost' id='btnSampleHtml'>填入示例 HTML（体验解析）</button>" +
        "<button class='btn primary' id='btnParseHtml'>解析预览</button></div>" +
        "</div>" +
        "<div class='tab-pane hidden' id='pane-excel'>" +
        "<p class='muted'>支持教务系统导出的 <b>.xls / .xlsx</b> 课表文件（自动识别“列表式”和“表格式”两种格式）。</p>" +
        "<div class='drop-zone' id='excelZone'>" +
        "<span class='dz-title'>📄 点击选择 Excel 文件</span>" +
        "<span class='dz-file' id='excelFileName'></span>" +
        "<input type='file' id='impFile' class='dz-input' accept='.xls,.xlsx'>" +
        "</div>" +
        "</div>" +
        "<div class='tab-pane hidden' id='pane-json'>" +
        "<p class='muted'>恢复本应用之前导出的 <b>.json</b> 备份（会完全替换当前数据）。</p>" +
        "<div class='drop-zone' id='jsonZone'>" +
        "<span class='dz-title'>🗂 点击选择 JSON 备份文件</span>" +
        "<span class='dz-file' id='jsonFileName'></span>" +
        "<input type='file' id='impJson' class='dz-input' accept='.json,application/json'>" +
        "</div>" +
        "</div>" +
        "<div id='impPreview'></div>",
      footerHtml:
        "<label class='radio inline'><input type='radio' name='impMode' value='merge' checked> 合并到现有课表</label>" +
        "<label class='radio inline'><input type='radio' name='impMode' value='replace'> 替换全部课表</label>" +
        "<span class='spacer'></span>" +
        "<button class='btn' id='impCancel'>关闭</button>" +
        "<button class='btn primary' id='impConfirm' disabled>确认导入</button>"
    });
    const b = m.body;
    const foot = m.card.querySelector(".modal-foot");
    const tabs = b.querySelectorAll(".tab-btn");
    const panes = { html: b.querySelector("#pane-html"), excel: b.querySelector("#pane-excel"), json: b.querySelector("#pane-json") };

    tabs.forEach(t => t.onclick = () => {
      tabs.forEach(x => x.classList.toggle("on", x === t));
      Object.keys(panes).forEach(k => panes[k].classList.toggle("hidden", k !== t.dataset.tab));
    });

    b.querySelector("#btnSampleHtml").onclick = () => { b.querySelector("#impHtml").value = SAMPLE_HTML; };
    b.querySelector("#btnParseHtml").onclick = () => {
      const html = b.querySelector("#impHtml").value.trim();
      if (!html) { U.toast("请先粘贴课表 HTML", "error"); return; }
      const r = P.parseHtml(html);
      if (!r.ok) { U.toast(r.error, "error"); showImportPreview([]); return; }
      pendingImport = r.sessions;
      showImportPreview(r.sessions);
      foot.querySelector("#impConfirm").disabled = false;
      U.toast("解析成功：" + r.sessions.length + " 条排课", "success");
    };

    const fileInput = b.querySelector("#impFile");
    const excelName = b.querySelector("#excelFileName");
    const jsonInput = b.querySelector("#impJson");
    const jsonName = b.querySelector("#jsonFileName");

    /** 读取文本文件：优先 File.text()，否则退回 FileReader */
    async function readTextFile(f) {
      if (typeof f.text === "function") return f.text();
      return U.fileToText(f);
    }

    // 注意：不再给 drop-zone 绑定 click → input.click()，否则会与 input 自身点击
    // 叠加触发，导致部分安卓浏览器打开两次选择器、change 事件被吞。
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files[0];
      fileInput.value = ""; // 允许重复选择同一个文件
      if (!f) return;
      excelName.classList.remove("err");
      excelName.textContent = "已选择：" + f.name;
      try {
        if (!window.XLSX) throw new Error("Excel 解析库未加载");
        const buf = await U.fileToArrayBuffer(f);
        const r = parseWorkbook(buf);
        if (!r.ok) {
          showImportPreview([]);
          excelName.textContent = "解析失败：" + r.error;
          excelName.classList.add("err");
          U.toast(r.error, "error");
          return;
        }
        pendingImport = r.sessions;
        showImportPreview(r.sessions);
        foot.querySelector("#impConfirm").disabled = false;
        U.toast("解析成功：" + r.sessions.length + " 条排课", "success");
      } catch (e) {
        excelName.textContent = "读取失败：" + e.message;
        excelName.classList.add("err");
        U.toast("读取 Excel 失败：" + e.message, "error");
      }
    });

    jsonInput.addEventListener("change", async () => {
      const f = jsonInput.files[0];
      jsonInput.value = "";
      if (!f) return;
      jsonName.classList.remove("err");
      jsonName.textContent = "已选择：" + f.name;
      try {
        const text = await readTextFile(f);
        const data = JSON.parse(text);
        if (!data || (!Array.isArray(data.courses) && !Array.isArray(data.sessions))) {
          throw new Error("文件内容缺少 courses / sessions 字段");
        }
        const restored = S.normalize(data);
        const ok = await U.confirmDialog("恢复备份",
          "备份包含 " + restored.courses.length + " 门课、 " + restored.sessions.length + " 条排课，将完全替换当前数据，确定继续？");
        if (!ok) return;
        state = restored;
        save(); viewWeek = computeViewWeek(); render(); m.close();
        U.toast("备份已恢复", "success");
      } catch (e) {
        jsonName.textContent = "导入失败：" + e.message;
        jsonName.classList.add("err");
        U.toast("备份文件解析失败：" + e.message, "error");
      }
    });

    foot.querySelector("#impCancel").onclick = () => m.close();
    foot.querySelector("#impConfirm").onclick = () => {
      if (!pendingImport) return;
      const mode = (foot.querySelector("input[name='impMode']:checked") || {}).value || "merge";
      applyImport(pendingImport, mode);
      m.close();
    };
  }

  /** 解析 Excel 工作簿：优先自建带 rowspan 的 HTML，再尝试列表式 */
  function parseWorkbook(buf) {
    const wb = XLSX.read(buf, { type: "array" });
    let best = null;
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws || !ws["!ref"]) continue;
      try {
        const html = sheetToHtmlWithMerges(ws);
        const r = P.parseHtml(html);
        if (r.ok && (!best || r.sessions.length > best.sessions.length)) best = r;
      } catch (e) { /* 尝试下一种方式 */ }
      try {
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
        const r = P.parseAoa(aoa);
        if (r.ok && (!best || r.sessions.length > best.sessions.length)) best = r;
      } catch (e) { /* 忽略 */ }
    }
    return best || { ok: false, error: "未能从该 Excel 中解析出课表，建议改用「粘贴课表 HTML」方式导入" };
  }

  /** 把工作表转成带 rowspan/colspan 的 HTML 表格（处理合并单元格） */
  function sheetToHtmlWithMerges(ws) {
    const ref = XLSX.utils.decode_range(ws["!ref"]);
    const merges = ws["!merges"] || [];
    const inMerge = (r, c) => merges.find(mg => r >= mg.s.r && r <= mg.e.r && c >= mg.s.c && c <= mg.e.c && !(r === mg.s.r && c === mg.s.c));
    const cellText = (r, c) => {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) return "";
      const v = cell.w !== undefined ? cell.w : cell.v;
      return v == null ? "" : String(v);
    };
    let html = "<table>";
    for (let r = ref.s.r; r <= ref.e.r; r++) {
      html += "<tr>";
      for (let c = ref.s.c; c <= ref.e.c; c++) {
        const mg = merges.find(x => x.s.r === r && x.s.c === c);
        if (inMerge(r, c)) continue;
        const rs = mg ? mg.e.r - mg.s.r + 1 : 1;
        const cs = mg ? mg.e.c - mg.s.c + 1 : 1;
        const text = U.esc(cellText(r, c)).replace(/\n/g, "<br/>");
        html += "<td" + (rs > 1 ? " rowspan='" + rs + "'" : "") + (cs > 1 ? " colspan='" + cs + "'" : "") + ">" + text + "</td>";
      }
      html += "</tr>";
    }
    return html + "</table>";
  }

  function applyImport(list, mode) {
    if (mode === "replace") { state.courses = []; state.sessions = []; }
    let addedC = 0, addedS = 0, merged = 0;
    for (const p of list) {
      let course = state.courses.find(c =>
        c.name === p.name && c.teacher === (p.teacher || "") && c.location === (p.location || ""));
      if (!course) {
        course = { id: S.uid(), name: p.name, teacher: p.teacher || "", location: p.location || "", color: M.colorFor(p.name) };
        state.courses.push(course);
        addedC++;
      }
      const existing = state.sessions.find(s =>
        s.courseId === course.id && s.day === p.day &&
        s.startPeriod === p.startPeriod && s.endPeriod === p.endPeriod &&
        (s.parity || "all") === (p.parity || "all"));
      if (existing) {
        if (p.weekRanges) {
          existing.weekRanges = existing.weekRanges
            ? M.mergeRangeLists(existing.weekRanges, p.weekRanges)
            : p.weekRanges.map(x => ({ ...x }));
        }
        merged++;
      } else {
        state.sessions.push({
          id: S.uid(), courseId: course.id, day: p.day,
          startPeriod: p.startPeriod, endPeriod: p.endPeriod,
          weekRanges: p.weekRanges ? p.weekRanges.map(x => ({ ...x })) : null,
          parity: p.parity || "all"
        });
        addedS++;
      }
    }
    save(); viewWeek = computeViewWeek(); render();
    U.toast("导入完成：新增 " + addedC + " 门课、" + addedS + " 条排课，合并 " + merged + " 条", "success");
  }

  // ---------------- 导出 ----------------

  function openExportModal() {
    const m = U.modal({
      title: "导出",
      bodyHtml:
        "<div class='export-cards'>" +
        "<div class='export-card' id='expIcs'><div class='exp-icon'>📅</div><div><b>导出 .ics 日历</b><div class='muted'>导入手机/电脑日历（含单双周、教室、教师）</div></div></div>" +
        "<div class='export-card' id='expJson'><div class='exp-icon'>💾</div><div><b>导出 .json 备份</b><div class='muted'>完整备份数据，可随时恢复</div></div></div>" +
        "<div class='export-card' id='expPrint'><div class='exp-icon'>🖨</div><div><b>打印课表</b><div class='muted'>打印当前周视图</div></div></div>" +
        "</div>"
    });
    m.body.querySelector("#expIcs").onclick = () => {
      const enriched = state.sessions.map(s => {
        const c = courseOf(s);
        return {
          id: s.id, name: c.name, teacher: c.teacher, location: c.location,
          day: s.day, startPeriod: s.startPeriod, endPeriod: s.endPeriod,
          weekRanges: s.weekRanges, parity: s.parity
        };
      });
      const ics = M.buildICS(enriched, state.settings);
      U.download("课程表-" + state.settings.semesterStart + ".ics", ics, "text/calendar;charset=utf-8");
      U.toast("已导出 .ics 文件", "success");
    };
    m.body.querySelector("#expJson").onclick = () => {
      U.download("课程表备份-" + state.settings.semesterStart + ".json",
        JSON.stringify(state, null, 2), "application/json;charset=utf-8");
      U.toast("已导出备份文件", "success");
    };
    m.body.querySelector("#expPrint").onclick = () => {
      m.close();
      setTimeout(() => window.print(), 150);
    };
  }

  // ---------------- 设置 ----------------

  function openSettingsModal() {
    const st = state.settings;
    const periodRows = st.periodTimes.map((p, i) =>
      "<tr><td class='p-no'>第" + (i + 1) + "节</td>" +
      "<td><input type='time' class='p-start' value='" + p.start + "'></td>" +
      "<td><input type='time' class='p-end' value='" + p.end + "'></td>" +
      "<td><button class='icon-btn p-del' title='删除该节次'>✕</button></td></tr>").join("");

    const m = U.modal({
      title: "设置",
      bodyHtml:
        "<div class='form'>" +
        "<div class='form-row'>" +
        "<label>学期名称（可选）<input id='sName' value='" + U.esc(st.semesterName || "") + "' placeholder='如：2026-2027 第1学期'></label>" +
        "<label>开学日期（第1周周一）<input type='date' id='sStart' value='" + st.semesterStart + "'></label>" +
        "<label>总周数<input type='number' id='sWeeks' min='1' max='40' value='" + st.totalWeeks + "'></label>" +
        "</div>" +
        "<div class='form-row'>" +
        "<label class='check'><input type='checkbox' id='sWeekend'" + (st.showWeekends ? " checked" : "") + "> 显示周六/周日</label>" +
        "<label>节次时间预设<select id='sPreset'>" +
        "<option value=''>— 选择预设 —</option>" +
        "<option value='12'>标准 12 节（08:00-22:30）</option>" +
        "<option value='10'>10 节（含晚课到 21:35）</option>" +
        "<option value='8'>8 节（仅白天 08:00-17:40）</option>" +
        "</select></label>" +
        "</div>" +
        "<div class='period-editor'>" +
        "<div class='period-head'><b>节次时间表</b><button class='btn ghost' id='pAdd'>＋ 添加节次</button></div>" +
        "<table class='period-table'><thead><tr><th>节次</th><th>开始</th><th>结束</th><th></th></tr></thead>" +
        "<tbody id='pBody'>" + periodRows + "</tbody></table>" +
        "</div>" +
        "<div class='danger-zone'>" +
        "<button class='btn danger' id='sClear'>清空全部数据</button>" +
        "</div>" +
        "</div>",
      footerHtml:
        "<button class='btn' id='sCancel'>取消</button>" +
        "<button class='btn primary' id='sSave'>保存设置</button>"
    });
    const b = m.body;
    const foot = m.card.querySelector(".modal-foot");
    const tbody = b.querySelector("#pBody");

    function renumber() {
      tbody.querySelectorAll("tr").forEach((tr, i) => {
        tr.querySelector(".p-no").textContent = "第" + (i + 1) + "节";
      });
    }
    tbody.addEventListener("click", e => {
      const del = e.target.closest(".p-del");
      if (!del) return;
      if (tbody.querySelectorAll("tr").length <= 1) { U.toast("至少保留 1 个节次", "error"); return; }
      del.closest("tr").remove(); renumber();
    });
    b.querySelector("#pAdd").onclick = () => {
      const tr = U.el("tr",
        U.el("td", { class: "p-no" }, "第" + (tbody.children.length + 1) + "节"),
        U.el("td", {}, U.el("input", { class: "p-start", type: "time", value: "08:00" })),
        U.el("td", {}, U.el("input", { class: "p-end", type: "time", value: "08:45" })),
        U.el("td", {}, U.el("button", { class: "icon-btn p-del" }, "✕"))
      );
      tbody.appendChild(tr);
    };
    b.querySelector("#sPreset").onchange = () => {
      const v = b.querySelector("#sPreset").value;
      if (!v) return;
      const times = v === "12" ? M.DEFAULT_PERIOD_TIMES
        : v === "10" ? M.DEFAULT_PERIOD_TIMES.slice(0, 10)
        : M.DEFAULT_PERIOD_TIMES.slice(0, 8);
      tbody.innerHTML = times.map((p, i) =>
        "<tr><td class='p-no'>第" + (i + 1) + "节</td>" +
        "<td><input type='time' class='p-start' value='" + p.start + "'></td>" +
        "<td><input type='time' class='p-end' value='" + p.end + "'></td>" +
        "<td><button class='icon-btn p-del'>✕</button></td></tr>").join("");
    };

    foot.querySelector("#sCancel").onclick = () => m.close();
    foot.querySelector("#sSave").onclick = () => {
      const name = b.querySelector("#sName").value.trim();
      const start = b.querySelector("#sStart").value;
      const weeks = Math.max(1, Math.min(40, +b.querySelector("#sWeeks").value || 20));
      const showWeekends = b.querySelector("#sWeekend").checked;
      if (!start) { U.toast("请选择开学日期", "error"); return; }
      const periods = [];
      let valid = true;
      tbody.querySelectorAll("tr").forEach(tr => {
        const s0 = tr.querySelector(".p-start").value;
        const s1 = tr.querySelector(".p-end").value;
        if (!/^\d{1,2}:\d{2}$/.test(s0) || !/^\d{1,2}:\d{2}$/.test(s1)) { valid = false; return; }
        periods.push({ start: s0, end: s1 });
      });
      if (!valid) { U.toast("节次时间格式不正确", "error"); return; }
      state.settings.semesterName = name;
      state.settings.semesterStart = start;
      state.settings.totalWeeks = weeks;
      state.settings.periodTimes = periods;
      state.settings.showWeekends = showWeekends;
      save(); viewWeek = computeViewWeek(); render(); m.close();
      U.toast("设置已保存", "success");
    };
    b.querySelector("#sClear").onclick = async () => {
      const ok = await U.confirmDialog("清空数据", "将删除所有课程和设置，且不可恢复。确定继续？", true);
      if (!ok) return;
      S.clearState();
      state = S.loadState();
      viewWeek = computeViewWeek(); render(); m.close();
      U.toast("已清空全部数据", "success");
    };
  }

  // ---------------- 示例数据 ----------------

  const SAMPLE_SPECS = [
    { name: "高等数学A", teacher: "张伟", location: "教1-101", day: 1, s: 1, e: 2, weeks: null },
    { name: "大学英语（二）", teacher: "李芳", location: "外语楼302", day: 1, s: 3, e: 4, weeks: "1-16" },
    { name: "数据结构", teacher: "王强", location: "教3-205", day: 2, s: 1, e: 2, weeks: "1-16" },
    { name: "数据结构实验", teacher: "王强", location: "机房B401", day: 2, s: 7, e: 8, weeks: "9-16" },
    { name: "大学物理", teacher: "陈静", location: "理教201", day: 3, s: 1, e: 2, weeks: "1-16" },
    { name: "体育", teacher: "刘洋", location: "东操场", day: 3, s: 5, e: 6, weeks: "2-16双周" },
    { name: "大学物理实验", teacher: "陈静", location: "实验楼A302", day: 4, s: 5, e: 8, weeks: "1-16" },
    { name: "形势与政策", teacher: "赵敏", location: "大礼堂", day: 4, s: 9, e: 10, weeks: "1-4" },
    { name: "C语言程序设计", teacher: "孙磊", location: "教2-308", day: 5, s: 3, e: 4, weeks: "1-16" },
    { name: "线性代数", teacher: "周涛", location: "教2-105", day: 5, s: 1, e: 2, weeks: "1-15单周" }
  ];

  const SAMPLE_HTML =
    "<table border='1' cellspacing='0'>" +
    "<tr><th>&nbsp;</th><th>星期一</th><th>星期二</th><th>星期三</th><th>星期四</th><th>星期五</th><th>星期六</th><th>星期日</th></tr>" +
    "<tr><td>上午<br/>第1,2节</td><td>高等数学A<br/>张伟<br/>1-16周<br/>教1-101</td><td>大学英语（二）<br/>李芳<br/>2-16双周<br/>外语楼302</td><td>大学物理<br/>陈静<br/>1-8周<br/>理教201</td><td>&nbsp;</td><td>线性代数<br/>周涛<br/>1-15单周<br/>教2-105</td><td>&nbsp;</td><td>&nbsp;</td></tr>" +
    "<tr><td>第3,4节</td><td>数据结构<br/>王强<br/>1-16周<br/>教3-205</td><td>C语言程序设计<br/>孙磊<br/>1-16周<br/>机房B401</td><td>大学物理<br/>陈静<br/>9-16周<br/>理教201</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>" +
    "<tr><td>下午<br/>第5,6节</td><td>体育<br/>刘洋<br/>2-16周<br/>东操场</td><td>&nbsp;</td><td>&nbsp;</td><td rowspan='2'>大学物理实验<br/>陈静<br/>1-16周<br/>实验楼A302</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>" +
    "<tr><td>第7,8节</td><td>&nbsp;</td><td>数据结构实验<br/>王强<br/>9-16周<br/>机房B401</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>" +
    "<tr><td>晚上<br/>第9,10节</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>形势与政策<br/>赵敏<br/>1-4周<br/>大礼堂</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>" +
    "</table>";

  function loadSample() {
    const parsed = SAMPLE_SPECS.map(sp => {
      const w = sp.weeks ? P.parseWeekExpr(sp.weeks) : null;
      return {
        name: sp.name, teacher: sp.teacher, location: sp.location, day: sp.day,
        startPeriod: sp.s, endPeriod: sp.e,
        weekRanges: w ? w.ranges : null, parity: w ? w.parity : "all"
      };
    });
    applyImport(parsed, "merge");
  }

  // ---------------- 事件绑定 ----------------

  function bindEvents() {
    document.getElementById("btnPrevWeek").onclick = () => { viewWeek = Math.max(1, viewWeek - 1); render(); };
    document.getElementById("btnNextWeek").onclick = () => { viewWeek = Math.min(state.settings.totalWeeks, viewWeek + 1); render(); };
    document.getElementById("btnToday").onclick = () => { viewWeek = computeViewWeek(); render(); };
    document.getElementById("btnImport").onclick = openImportModal;
    document.getElementById("btnExport").onclick = openExportModal;
    document.getElementById("btnSettings").onclick = openSettingsModal;
    document.getElementById("btnAdd").onclick = () => openEditModal(null);
    document.getElementById("btnSample").onclick = () => {
      if (state.courses.length) {
        U.confirmDialog("载入示例", "将把示例课程合并到当前课表，确定继续？").then(ok => { if (ok) loadSample(); });
      } else loadSample();
    };
    document.getElementById("btnPrint").onclick = () => window.print();

    // 空状态页的按钮
    document.getElementById("btnEmptyImport").onclick = openImportModal;
    document.getElementById("btnEmptySample").onclick = () => loadSample();
    document.getElementById("btnEmptyAdd").onclick = () => openEditModal(null);

    document.getElementById("viewGridBtn").onclick = () => switchView("grid");
    document.getElementById("viewListBtn").onclick = () => switchView("list");

    document.getElementById("searchBox").addEventListener("input", e => {
      query = e.target.value.trim();
      render();
    });

    document.addEventListener("keydown", e => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (["input", "textarea", "select"].includes(tag)) return;
      if (document.querySelector(".modal-overlay")) return;
      if (e.key === "ArrowLeft") { viewWeek = Math.max(1, viewWeek - 1); render(); }
      if (e.key === "ArrowRight") { viewWeek = Math.min(state.settings.totalWeeks, viewWeek + 1); render(); }
    });
  }

  function switchView(v) {
    currentView = v;
    render();
  }

  // ---------------- 启动 ----------------

  bindEvents();
  render();
})();
