/**
 * parser.js — 课表解析器（纯逻辑，无 DOM 依赖，可在浏览器与 Node 中运行）
 *
 * 支持的输入：
 *   1. 教务系统课表页的 HTML 源码（粘贴整页或仅 <table> 部分）
 *      —— 兼容正方、强智、URP、青果等常见教务系统的“星期×节次”二维表格，
 *         自动识别表头行、节次列、rowspan/colspan 合并单元格、单双周、周次区间。
 *   2. Excel(.xls/.xlsx) 导出的课表：由 SheetJS 转成 HTML 表格或二维数组后再解析。
 *
 * 浏览器中以全局对象 ScheduleParser 暴露；Node 中通过 module.exports 暴露。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScheduleParser = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CJK = "\u4e00-\u9fa5";
  const WEEKDAY_CHAR = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  const WEEKDAY_EN = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

  // ---------------- 基础工具 ----------------

  /** 解码 HTML 实体，并把 <br>/</p>/</div> 等转为换行，去掉其余标签 */
  function stripTagsAndEntities(cellHtml) {
    let s = String(cellHtml || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li)>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;|&#160;|&ensp;|&emsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
      .replace(/&#x([0-9a-f]+);/gi, (m, d) => String.fromCharCode(parseInt(d, 16)))
      .replace(/[\u3000]/g, " ");
    return s;
  }

  /** 把单元格文本拆成若干“行”，每行内部再按连续空格拆成子行 */
  function linesOf(text) {
    const out = [];
    for (let raw of String(text || "").split(/\s*\n\s*/)) {
      raw = raw.trim();
      if (!raw) continue;
      for (let sub of raw.split(/\s{2,}/)) {
        sub = sub.trim();
        if (sub) out.push(sub);
      }
    }
    return out;
  }

  function chineseToInt(s) {
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (map[s]) return map[s];
    if (/^十[一二三四五六七八九]?$/.test(s)) return 10 + (map[s[1]] || 0);
    if (/^[一二三四五六七八九]十[一二三四五六七八九]?$/.test(s)) return map[s[0]] * 10 + (map[s[2]] || 0);
    return NaN;
  }

  // ---------------- 字段级识别 ----------------

  /** 识别“星期一 / 周一 / Monday / 一”等 → 1..7，失败返回 null */
  function parseWeekday(text) {
    const t = String(text || "").trim();
    let m = t.match(/周\s*([一二三四五六日天])|星期\s*([一二三四五六日天])/);
    if (m) return WEEKDAY_CHAR[m[1] || m[2]];
    m = t.match(/(Mon|Monday|Tue|Tuesday|Wed|Wednesday|Thu|Thursday|Fri|Friday|Sat|Saturday|Sun|Sunday)/i);
    if (m) return WEEKDAY_EN.indexOf(m[0].toLowerCase().slice(0, 3)) + 1;
    if (/^[一二三四五六日天]$/.test(t)) return WEEKDAY_CHAR[t];
    return null;
  }

  /** 识别节次（宽松版，供“节次列”表头使用）："第1-2节"、"3-4"、"第1,2节"、"第一大节"、"5" */
  function parseSection(text) {
    for (const line of linesOf(text)) {
      let m = line.match(/第\s*([一二三四五六七八九十]+)\s*大节/);
      if (m) { const n = chineseToInt(m[1]); if (!isNaN(n)) return { start: 2 * n - 1, end: 2 * n }; }
      m = line.match(/第\s*(\d+)\s*大节/);
      if (m) { const n = +m[1]; if (n >= 1 && n <= 15) return { start: 2 * n - 1, end: 2 * n }; }
      m = line.match(/第\s*([一二三四五六七八九十]+)\s*节/);
      if (m) { const n = chineseToInt(m[1]); if (!isNaN(n)) return { start: n, end: n }; }
      const seg = line.match(/([0-9,，、\s\-–—~～至]+)\s*节/);
      if (seg) {
        const nums = seg[1].match(/\d+/g);
        if (nums && nums.length) {
          const ns = nums.map(Number);
          return { start: Math.min(...ns), end: Math.max(...ns) };
        }
      }
      if (/^\s*\d+\s*[-–—~～至]\s*\d+\s*$/.test(line)) {
        const ns = line.match(/\d+/g).map(Number);
        return { start: Math.min(ns[0], ns[1]), end: Math.max(ns[0], ns[1]) };
      }
      if (/^\s*\d+\s*$/.test(line)) {
        const n = +line.trim();
        if (n >= 1 && n <= 30) return { start: n, end: n };
      }
    }
    return null;
  }

  /** 识别节次（严格版，供“单元格内部”使用：整行只能是节次，避免把课程名截断） */
  function parseSectionStrict(text) {
    const t = String(text || "").trim()
      .replace(/^(上午|下午|晚上|中午|早晨|夜间|清晨)/, "")
      .trim();
    if (!/^第?\s*[\d,，、\s\-–—~～至]{1,12}节?$/.test(t) || !/\d/.test(t)) return null;
    return parseSection(t);
  }

  /**
   * 解析“周次”表达式 → { ranges:[{start,end}], parity:'all'|'odd'|'even' } 或 null
   * 支持："1-16周"、"第1-16周"、"1-8,10-16周"、"1-16"、"1,3,5,7"、"2-16双周"、
   *        "1-16周(单)"、"单周"、"1-8周、10-16周"、"1-16W"
   */
  function parseWeekExpr(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    const hadWeekMark = /周|week|w/i.test(raw);
    const s0 = raw.replace(/[（(]([^）)]*)[）)]/g, "($1)");

    // 先于周次替换，在“归一化后的原文”上判断单双周
    let parity = "all";
    if (/[单双]\s*周/.test(s0) || /周\s*[（(]?\s*[单双]/.test(s0) || /[wW]\s*[单双]/.test(s0) || /\bodd\b/i.test(s0) || /\beven\b/i.test(s0)) {
      parity = /双|even/i.test(s0) ? "even" : "odd";
    } else if (hadWeekMark && /^[单双]/.test(raw)) {
      parity = raw[0] === "双" ? "even" : "odd";
    }

    let s = s0;
    const ranges = [];
    s = s.replace(/(\d+)\s*[-–—~～至]\s*(\d+)\s*(?:周|week|w)?/gi,
      (mm, a, b) => { ranges.push({ start: +a, end: +b }); return " "; });
    s = s.replace(/(\d+)\s*(?:周|week|w)/gi,
      (mm, a) => { ranges.push({ start: +a, end: +a }); return " "; });

    if (!hadWeekMark) {
      // 纯数字列表兜底："1,3,5"、"1-16"
      const compact = raw.replace(/[,，、;；\s\-–—~～至]/g, "");
      if (!/^\d+$/.test(compact) || !compact) return null;
      if (!ranges.length) {
        const nums = raw.split(/[,，、;；\-–—~～至]+/).map(x => +x.trim()).filter(n => !isNaN(n) && n > 0);
        for (const n of nums) ranges.push({ start: n, end: n });
      }
    }
    if (!ranges.length) return null;
    // 合理性检查：>60 的数字大概率不是周次（可能是教室号/学号）
    if (ranges.some(r => r.start > 60 || r.end > 60)) return null;
    return { ranges: mergeRangeLists(ranges), parity };
  }

  /** 区间列表合并（排序、相邻合并） */
  function mergeRangeLists(list) {
    const all = list.map(r => ({ start: Math.min(r.start, r.end), end: Math.max(r.start, r.end) }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const out = [];
    for (const r of all) {
      const last = out[out.length - 1];
      if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
      else out.push({ ...r });
    }
    return out;
  }

  const TEACHER_BLACKLIST = new Set([
    "教师", "老师", "讲师", "教授", "助教", "上课", "节次", "时间", "周次",
    "地点", "教室", "备注", "课程", "名称", "上课地点", "任课教师", "星期", "时段"
  ]);

  /** 识别教师姓名："张三"、"张三/李四"、"JOHN SMITH"；前面可带“教师:”等标签 */
  function parseTeacher(text) {
    const t = String(text || "").trim();
    if (!t) return null;
    const s = t.replace(/^(?:任课教师|授课教师|教师|老师)\s*[:：]?\s*/i, "");
    if (!s) return null;
    if (/^[A-Za-z][A-Za-z .\-'·]{1,25}$/.test(s) && s.length >= 2 && s.length <= 26) return s;
    const re = new RegExp("^[" + CJK + "·]{2,4}(?:[\\/、][" + CJK + "·]{2,4})?$");
    if (re.test(s) && !TEACHER_BLACKLIST.has(s)) return s;
    return null;
  }

  /** 识别上课地点（教室/楼/场馆等） */
  function parseLocation(text) {
    let s = String(text || "").trim();
    if (!s) return null;
    s = s.replace(/^(?:上课地点|地点|教室|位置)\s*[:：]?\s*/i, "");
    if (!s) return null;
    const hasDigit = /\d/.test(s);
    const hasHint = /(楼|室|馆|场|厅|堂|园|机房|语音|实验|操场|room|building|lab|gym|教\d|[A-Za-z]\d{2,})/i.test(s);
    if (!hasHint) return null;
    // 排除纯课程名（如“大学物理实验”）：不含数字且 >4 个汉字 → 不是地点
    if (!hasDigit && new RegExp("^[" + CJK + "]{5,}$").test(s)) return null;
    if (s.length > 30) return null;
    return s;
  }

  /** 解析一个单元格的整段文本 → 课程字段 */
  function parseCellText(rawText) {
    const res = {
      name: null, teacher: null, location: null,
      weekRanges: null, parity: "all", section: null
    };
    const teacherCands = [];
    const others = [];
    for (const line of linesOf(rawText)) {
      const w = parseWeekExpr(line);
      if (w) {
        res.weekRanges = res.weekRanges ? mergeRangeLists([...res.weekRanges, ...w.ranges]) : w.ranges;
        if (w.parity !== "all") res.parity = w.parity;
        continue;
      }
      const sec = parseSectionStrict(line);
      if (sec) { res.section = sec; continue; }
      // 地点先于教师判断：避免“东操场”“大礼堂”被当成姓名
      const loc = parseLocation(line);
      if (loc) { if (!res.location) res.location = loc; continue; }
      const t = parseTeacher(line);
      if (t) { teacherCands.push(t); continue; }
      others.push(line);
    }
    // 课程名：优先取第一个“其他”行（最可能是课程名）；
    // 若没有（如“大学物理\n陈静”），取第一个姓名候选行
    if (others.length) res.name = others[0];
    else if (teacherCands.length) res.name = teacherCands[0];
    if (res.name && res.name.length > 40) res.name = res.name.slice(0, 40);
    // 教师：取第一个不等于课程名的那一行
    for (const t of teacherCands) {
      if (t !== res.name) { res.teacher = t; break; }
    }
    if (!res.name) res.name = linesOf(rawText)[0] || null;
    return res;
  }

  // ---------------- 表格提取与网格化 ----------------

  /** 从 HTML 源码中提取所有 <table> 内部内容 */
  function extractTables(html) {
    const tables = [];
    const re = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
    let m;
    while ((m = re.exec(String(html || "")))) tables.push(m[1]);
    return tables;
  }

  /**
   * 把 <table> 内部 HTML 解析成网格：
   *   [{ row, col, rowspan, colspan, text }]（含 rowspan/colspan 占位展开后的坐标）
   * 只保留前 8 列（0=节次列，1..7=周一..周日）。
   */
  function parseTableGrid(tableInnerHtml) {
    const rowsHtml = [];
    const reRow = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;
    while ((m = reRow.exec(String(tableInnerHtml || "")))) rowsHtml.push(m[1]);

    const gridRows = [];
    const carry = new Array(9).fill(0); // 每个列位上由上一行 rowspan 造成的占用
    rowsHtml.forEach((rowHtml, rIdx) => {
      const cells = [];
      const reCell = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
      let cm;
      while ((cm = reCell.exec(rowHtml))) cells.push(cm);
      let col = 0;
      const placed = [];
      for (const cm of cells) {
        const attrs = cm[2] || "";
        const cs = Math.max(1, +((attrs.match(/colspan\s*=\s*["']?(\d+)/i) || [])[1] || 1));
        const rs = Math.max(1, +((attrs.match(/rowspan\s*=\s*["']?(\d+)/i) || [])[1] || 1));
        while (col < 8 && carry[col] > 0) { carry[col]--; col++; }
        if (col >= 8) continue;
        const effCs = Math.min(cs, 8 - col);
        placed.push({
          row: rIdx, col,
          rowspan: rs, colspan: effCs,
          text: stripTagsAndEntities(cm[3])
        });
        if (rs > 1) {
          for (let i = 0; i < effCs; i++) carry[col + i] = Math.max(carry[col + i], rs - 1);
        }
        col += cs;
      }
      gridRows.push(placed);
    });
    return gridRows;
  }

  /** 表头信息：星期列映射 + 表头行数 */
  function headerInfo(gridRows) {
    const weekdays = new Array(8).fill(null);
    for (const row of gridRows) {
      for (const cell of row) {
        if (cell.col >= 1 && cell.col <= 7) {
          const d = parseWeekday(cell.text);
          if (d) {
            for (let i = 0; i < cell.colspan && cell.col + i <= 7; i++) {
              const dd = Math.min(d + i, 7);
              if (!weekdays[cell.col + i]) weekdays[cell.col + i] = dd;
            }
          }
        }
      }
    }
    // 表头行数 = 第一行“内容行”之前的行数
    const headerRows = gridRows.findIndex(row =>
      row.some(cell =>
        cell.col >= 1 && cell.col <= 7 &&
        cell.text.trim() && !isHeaderish(cell.text)
      )
    );
    const hr = headerRows === -1 ? 0 : headerRows;
    for (let d = 1; d <= 7; d++) if (!weekdays[d]) weekdays[d] = d;
    return { weekdays, headerRows: hr };
  }

  /** 该单元格文本是否只是表头文字（星期、节次、时间等） */
  function isHeaderish(text) {
    const t = String(text || "").trim();
    if (!t) return true;
    if (parseWeekday(t)) return true;
    if (/^(?:节次|星期|周次|时间|时段|课程表|排课|日期|上午|下午|晚上|中午|早晨|夜间|清晨|午间|备注)$/.test(t)) return true;
    return false;
  }

  const LABEL_RE = /^(上午|下午|晚上|中午|早晨|夜间|清晨|午间)$/;

  /** 由网格解析出课程会话 */
  function parseGrid(gridRows, header) {
    const sessions = [];
    const periodOfRow = new Array(gridRows.length).fill(null);
    let runningPeriod = 1;

    // 第一遍：确定每行的节次范围
    for (let r = header.headerRows; r < gridRows.length; r++) {
      const row = gridRows[r];
      const first = row.find(c => c.col === 0);
      const label = first ? first.text.trim() : "";
      const hasData = row.some(c => c.col >= 1 && c.col <= 7 && c.text.trim().length >= 2);
      if (!hasData && LABEL_RE.test(label)) continue; // 纯时段标签行（“上午/下午…”），不占节次
      const sec = first ? parseSection(first.text) : null;
      if (sec) {
        periodOfRow[r] = sec;
        runningPeriod = sec.end + 1;
      } else if (hasData) {
        periodOfRow[r] = { start: runningPeriod, end: runningPeriod };
        runningPeriod++;
      }
    }

    // 第二遍：提取课程
    for (let r = header.headerRows; r < gridRows.length; r++) {
      const row = gridRows[r];
      const pr = periodOfRow[r];
      if (!pr) continue;
      for (const cell of row) {
        if (cell.col < 1 || cell.col > 7) continue;
        const text = cell.text.trim();
        if (text.length < 2) continue;
        if (parseWeekday(text) && text.length <= 12) continue; // 表头星期文字
        const day = header.weekdays[cell.col];
        if (!day) continue;
        let endPeriod = pr.end;
        const endRow = r + cell.rowspan - 1;
        for (let rr = r + 1; rr <= endRow; rr++) {
          if (periodOfRow[rr]) endPeriod = periodOfRow[rr].end;
        }
        const parsed = parseCellText(text);
        const sec = parsed.section || { start: pr.start, end: endPeriod };
        if (!parsed.name) continue;
        sessions.push({
          name: parsed.name,
          teacher: parsed.teacher || "",
          location: parsed.location || "",
          day,
          startPeriod: Math.min(sec.start, sec.end),
          endPeriod: Math.max(sec.start, sec.end),
          weekRanges: parsed.weekRanges ? parsed.weekRanges.map(x => ({ ...x })) : null,
          parity: parsed.parity || "all"
        });
      }
    }
    return sessions;
  }

  /**
   * 纵向相邻合并：同一星期、内容完全一致（课程/教师/地点/周次/单双周）且节次首尾相接的
   * 两条排课（如“第1节”与“第2节”两个独立单元格），合并为一条跨节次的排课。
   */
  function mergeAdjacentSessions(list) {
    const arr = list.map(s => ({
      ...s,
      weekRanges: s.weekRanges ? s.weekRanges.map(r => ({ ...r })) : null
    }));
    arr.sort((x, y) => x.day - y.day || x.startPeriod - y.startPeriod || x.endPeriod - y.endPeriod);
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (b.day !== a.day || b.startPeriod > a.endPeriod + 1) break;
        if (b.startPeriod === a.endPeriod + 1 &&
            a.name === b.name && a.teacher === b.teacher && a.location === b.location &&
            (a.parity || "all") === (b.parity || "all") &&
            JSON.stringify(a.weekRanges) === JSON.stringify(b.weekRanges)) {
          a.endPeriod = Math.max(a.endPeriod, b.endPeriod);
          arr.splice(j, 1);
          j--;
        }
      }
    }
    return arr;
  }

  /** 相同课程（同名/同教师/同地点/同天/同节次/同单双周）合并周次 */
  function mergeSessions(list) {
    const map = new Map();
    for (const s of list) {
      const key = [
        s.name, s.teacher || "", s.location || "",
        s.day, s.startPeriod, s.endPeriod, s.parity || "all"
      ].join("\u0001");
      const cur = map.get(key);
      if (!cur) {
        map.set(key, {
          ...s,
          weekRanges: s.weekRanges ? s.weekRanges.map(x => ({ ...x })) : null,
          parity: s.parity || "all"
        });
      } else if (s.weekRanges) {
        cur.weekRanges = cur.weekRanges ? mergeRangeLists([...cur.weekRanges, ...s.weekRanges]) : s.weekRanges.map(x => ({ ...x }));
      }
    }
    return [...map.values()];
  }

  /**
   * 主入口：解析 HTML 源码（整页或片段均可）
   * 返回 { ok, sessions | error, rawCount }
   */
  function parseHtml(html) {
    const tables = extractTables(html);
    if (!tables.length) return { ok: false, error: "未在文本中找到 <table> 表格，请确认复制的是课表页面的 HTML 源码" };
    let best = null;
    for (const t of tables) {
      const gridRows = parseTableGrid(t);
      const header = headerInfo(gridRows);
      const sessions = mergeAdjacentSessions(parseGrid(gridRows, header));
      if (!best || sessions.length > best.sessions.length) {
        best = { sessions };
      }
    }
    if (!best || !best.sessions.length) {
      return { ok: false, error: "找到了表格，但没有解析出课程。请确认表格中含有课程名称、教室、周次等信息" };
    }
    return { ok: true, sessions: mergeSessions(best.sessions), rawCount: best.sessions.length, warnings: [] };
  }

  // ---------------- Excel 二维数组（列表式）解析 ----------------

  const ALIAS = {
    name: ["课程名称", "课程名", "课程", "名称", "course"],
    teacher: ["任课教师", "授课教师", "教师", "老师", "teacher"],
    weeks: ["上课周次", "周次", "周数", "weeks", "周"],
    day: ["星期", "周几", "weekday", "day"],
    section: ["节次", "上课节次", "时间", "节", "period", "section", "time"],
    location: ["上课地点", "地点", "教室", "location", "room", "地址"]
  };

  function normHeader(s) {
    return String(s || "").replace(/[\s:：()（）*]/g, "").toLowerCase();
  }

  /** 在二维数组里找“表头行”（列表式课表），返回 { rowIndex, map } 或 null */
  function detectListHeader(aoa) {
    for (let r = 0; r < Math.min(aoa.length, 5); r++) {
      const map = {};
      const cells = (aoa[r] || []).map(normHeader);
      let hits = 0;
      for (const key of Object.keys(ALIAS)) {
        for (let c = 0; c < cells.length; c++) {
          if (!cells[c]) continue;
          if (ALIAS[key].some(a => cells[c] === a || cells[c].startsWith(a) && a.length >= 2)) {
            if (map[key] === undefined) { map[key] = c; hits++; }
          }
        }
      }
      if (hits >= 3 && map.name !== undefined && map.day !== undefined) return { rowIndex: r, map };
    }
    return null;
  }

  /** 列表式二维数组 → 课程会话 */
  function parseListRows(aoa, headerRow) {
    const { rowIndex, map } = headerRow;
    const out = [];
    for (let r = rowIndex + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const get = k => (map[k] !== undefined && row[map[k]] !== undefined ? String(row[map[k]]).trim() : "");
      const name = get("name");
      if (!name || name.length < 2) continue;
      const teacher = get("teacher");
      const location = get("location");
      const sec = parseSection(get("section")) || { start: 1, end: 1 };
      let day = parseWeekday(get("day"));
      if (!day) {
        const n = +get("day").replace(/[^0-9]/g, "");
        if (n >= 1 && n <= 7) day = n;
      }
      if (!day) day = 1;
      const weekRaw = get("weeks");
      const w = parseWeekExpr(weekRaw);
      // 若“周次”列没解析出来，尝试“时间”列里同时带周次（如“1-16周 第1-2节”）
      const w2 = !w ? parseWeekExpr(get("section")) : null;
      out.push({
        name, teacher, location, day,
        startPeriod: Math.min(sec.start, sec.end),
        endPeriod: Math.max(sec.start, sec.end),
        weekRanges: w ? w.ranges : (w2 ? w2.ranges : null),
        parity: w ? w.parity : (w2 ? w2.parity : "all")
      });
    }
    return out;
  }

  /**
   * 主入口：解析 Excel 二维数组（SheetJS sheet_to_json({header:1}) 的结果）
   * 自动识别“列表式”或“网格式”，也支持单元格里直接存整段 HTML 的导出。
   */
  function parseAoa(aoa) {
    if (!Array.isArray(aoa) || !aoa.length) return { ok: false, error: "Excel 内容为空" };
    const allText = aoa.flat().filter(v => typeof v === "string").join("\n");
    if (/<table/i.test(allText)) {
      const r = parseHtml(allText);
      if (r.ok) return r;
    }
    const listHeader = detectListHeader(aoa);
    if (listHeader) {
      const sessions = parseListRows(aoa, listHeader);
      if (sessions.length) return { ok: true, sessions: mergeSessions(sessions), rawCount: sessions.length, warnings: [] };
    }
    return { ok: false, error: "无法识别该 Excel 的课表格式。建议改用「粘贴课表 HTML」方式导入" };
  }

  return {
    stripTagsAndEntities, linesOf, parseWeekday, parseSection, parseSectionStrict,
    parseWeekExpr, mergeRangeLists, parseTeacher, parseLocation, parseCellText,
    extractTables, parseTableGrid, headerInfo, parseGrid, mergeSessions, mergeAdjacentSessions,
    parseHtml, parseAoa, detectListHeader, parseListRows
  };
});
