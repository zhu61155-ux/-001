/**
 * ui.js — 通用 UI 组件：DOM 辅助、弹窗、Toast、文件下载
 */
(function (root) {
  "use strict";

  /** 创建元素：el('div', {class:'x', onclick:fn}, '文本', childNode...) */
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null) continue;
        if (k === "class") node.className = v;
        else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else if (k === "html") node.innerHTML = v;
        else if (k === "value") node.value = v;
        else if (k === "checked") node.checked = !!v;
        else if (k === "dataset") Object.assign(node.dataset, v);
        else node.setAttribute(k, v);
      }
    }
    for (const c of children) {
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ---------------- Toast ----------------

  let toastRoot = null;
  function toast(msg, type) {
    if (!toastRoot) {
      toastRoot = document.createElement("div");
      toastRoot.className = "toast-root";
      document.body.appendChild(toastRoot);
    }
    const t = document.createElement("div");
    t.className = "toast " + (type || "info");
    t.textContent = msg;
    toastRoot.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 300);
    }, 2600);
  }

  // ---------------- 弹窗 ----------------

  function modal(opts) {
    const overlay = el("div", { class: "modal-overlay" });
    const card = el("div", { class: "modal-card" + (opts.wide ? " wide" : "") });
    const head = el("div", { class: "modal-head" },
      el("div", { class: "modal-title" }, opts.title || ""),
      el("button", {
        class: "icon-btn", title: "关闭",
        onclick: () => close()
      }, "✕")
    );
    const body = el("div", { class: "modal-body", html: opts.bodyHtml || "" });
    const foot = opts.footerHtml
      ? el("div", { class: "modal-foot", html: opts.footerHtml })
      : null;
    card.append(head, body);
    if (foot) card.appendChild(foot);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function close() {
      document.removeEventListener("keydown", onKey);
      overlay.classList.add("closing");
      setTimeout(() => overlay.remove(), 180);
    }
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
    }
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("mousedown", e => { if (e.target === overlay) close(); });

    // 把 body 里的元素挂到 events 供调用方使用
    const api = { overlay, card, body, close };
    if (opts.onMount) opts.onMount(api);
    return api;
  }

  /** 简单确认框 → Promise<boolean> */
  function confirmDialog(title, msg, danger) {
    return new Promise(resolve => {
      const m = modal({
        title,
        bodyHtml: "<p class='confirm-text'>" + esc(msg) + "</p>",
        footerHtml:
          "<button class='btn' data-act='cancel'>取消</button>" +
          "<button class='btn " + (danger ? "danger" : "primary") + "' data-act='ok'>确定</button>",
        onMount(api) {
          const foot = api.card.querySelector(".modal-foot");
          foot.querySelector('[data-act="ok"]').onclick = () => { api.close(); resolve(true); };
          foot.querySelector('[data-act="cancel"]').onclick = () => { api.close(); resolve(false); };
        }
      });
    });
  }

  // ---------------- 文件 ----------------

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
  }

  function fileToText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("读取文件失败"));
      r.readAsText(file);
    });
  }

  function fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("读取文件失败"));
      r.readAsArrayBuffer(file);
    });
  }

  root.UI = { el, esc, toast, modal, confirmDialog, download, fileToText, fileToArrayBuffer };
})(typeof self !== "undefined" ? self : this);
