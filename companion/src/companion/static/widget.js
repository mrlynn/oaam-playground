// The chat as a floating panel on the inspector's and the docs' pages (./demo.sh serves all
// three at one origin). It is the chat page's conversation, not a second one: the same session
// in sessionStorage, the same message markup, so /chat and this panel show one thread.
// After each turn it fires "companion:remembered" on window, so the page under it can refresh.
(() => {
  if (window.__companionWidget) return;
  window.__companionWidget = true;
  const script = document.currentScript;
  const BASE = script && script.src ? new URL(script.src).pathname.replace(/\/widget\.js$/, "") : "/chat";
  const here = location.pathname.replace(/\/+$/, "");
  if (here === BASE || here.startsWith(BASE + "/")) return;  // the full chat page is the chat

  const SAVED = "companion.session", OPEN = "companion.widget.open", MODEL_KEY = "companion.model";
  const get = (s, k) => { try { return s.getItem(k); } catch { return null; } };
  const put = (s, k, v) => { try { v == null ? s.removeItem(k) : s.setItem(k, v); } catch {} };
  const saved = {
    get() { try { return JSON.parse(get(sessionStorage, SAVED) || "null"); } catch { return null; } },
    set(v) { put(sessionStorage, SAVED, JSON.stringify(v)); },
  };

  const CSS = `
    :host { all: initial; --bg: #f7f6f3; --panel: #ffffff; --ink: #1d1c1a; --muted: #6b6862; --line: #e4e1db;
      --accent: #2f5d8a; --accent-ink: #ffffff; --you: #eaf0f6; --warn: #9a3b1b;
      --mono: ui-monospace, SFMono-Regular, Menlo, monospace; }
    :host([data-theme="dark"]) { --bg: #151514; --panel: #1e1e1c; --ink: #ecebe8; --muted: #9c9993; --line: #33322f;
      --accent: #7fa9d4; --accent-ink: #10181f; --you: #1f2a35; --warn: #e08a68; }
    * { box-sizing: border-box; }
    .root { position: fixed; right: 20px; bottom: 20px; z-index: 1250; color: var(--ink);
      font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
    button { font: inherit; font-size: 12px; border: 1px solid var(--line); background: var(--panel); color: var(--ink);
      border-radius: 6px; padding: 3px 8px; cursor: pointer; }
    button:hover:not(:disabled) { border-color: var(--accent); }
    button:disabled { opacity: .5; cursor: default; }
    button:focus-visible, a:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .launch { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 999px; font-size: 14px;
      font-weight: 600; background: var(--accent); color: var(--accent-ink); border-color: var(--accent);
      box-shadow: 0 6px 20px rgba(0,0,0,.18); }
    .launch svg { width: 18px; height: 18px; }
    .panel { display: none; flex-direction: column; width: 380px; height: min(580px, calc(100vh - 40px));
      background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
      box-shadow: 0 12px 40px rgba(0,0,0,.22); }
    .root.open .panel { display: flex; }
    .root.open .launch { display: none; }
    header { display: flex; align-items: center; gap: 6px; padding: 8px 10px 8px 14px; border-bottom: 1px solid var(--line); }
    header b { font-size: 14px; }
    .meta { flex: 1; min-width: 0; color: var(--muted); font: 12px var(--mono); overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; }
    header a { color: var(--muted); font-size: 12px; text-decoration: none; padding: 3px 4px; }
    header a:hover { color: var(--ink); }
    .x { border: 0; font-size: 18px; line-height: 1; padding: 2px 6px; color: var(--muted); background: none; }
    .log { flex: 1; overflow-y: auto; padding: 14px 14px 4px; background: var(--bg); }
    .msg { margin: 0 0 14px; }
    .msg .who { font-size: 11px; color: var(--muted); margin-bottom: 2px; }
    .msg .text { white-space: pre-wrap; overflow-wrap: anywhere; }
    .msg.you .text { background: var(--you); border-radius: 8px; padding: 6px 10px; display: inline-block; max-width: 100%; }
    .msg.note .text { color: var(--muted); font: 12px var(--mono); }
    .msg.error .text { color: var(--warn); font: 12px var(--mono); }
    .status { font: 11px var(--mono); color: var(--muted); margin-top: 4px; display: flex; gap: 8px; flex-wrap: wrap; }
    .status a, .status button.link { color: var(--accent); background: none; border: 0; padding: 0; font: inherit;
      cursor: pointer; text-decoration: none; }
    .status a:hover, .status button.link:hover { text-decoration: underline; }
    .pending { animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: .4; } }
    form { display: flex; gap: 6px; align-items: flex-end; padding: 10px; border-top: 1px solid var(--line); margin: 0; }
    textarea { flex: 1; font: inherit; color: var(--ink); background: var(--bg); border: 1px solid var(--line);
      border-radius: 8px; padding: 6px 8px; resize: none; max-height: 140px; }
    .send { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-size: 13px; padding: 6px 12px; }
    @media (max-width: 520px) {
      .root { right: 8px; bottom: 8px; left: 8px; display: flex; justify-content: flex-end; }
      .panel { width: 100%; height: min(75vh, 580px); }
    }
    @media (prefers-reduced-motion: reduce) { .pending { animation: none; } }`;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const short = (id) => id ? id.slice(0, 8) + "…" : "";

  const host = el("div");
  host.id = "companion-widget";
  const shadow = host.attachShadow({ mode: "open" });
  const style = el("style"); style.textContent = CSS;
  const root = el("div", "root");
  const launch = el("button", "launch");
  launch.type = "button"; launch.setAttribute("aria-expanded", "false");
  launch.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
    + 'stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  launch.append("Chat");
  const panel = el("section", "panel");
  panel.setAttribute("aria-label", "Chat with the companion");
  const head = el("header");
  const meta = el("span", "meta", "connecting…");
  const newBtn = el("button", null, "new thread");
  newBtn.type = "button"; newBtn.title = "Start a new thread. Memories carry across threads.";
  const full = el("a", null, "full chat ↗");
  full.href = BASE; full.title = "The same conversation on the full chat page, with model choice and why";
  const close = el("button", "x", "×");
  close.type = "button"; close.setAttribute("aria-label", "Close chat");
  head.append(el("b", null, "Chat"), meta, newBtn, full, close);
  const log = el("div", "log"); log.setAttribute("aria-live", "polite");
  const msgs = el("div");
  log.append(msgs);
  const form = el("form");
  const input = el("textarea");
  input.rows = 1; input.placeholder = "Talk through your work…"; input.setAttribute("aria-label", "Message");
  const send = el("button", "send", "Send");
  form.append(input, send);
  panel.append(head, log, form);
  root.append(launch, panel);
  shadow.append(style, root);

  // Follow the page's theme: MUI puts a class on <html>, Docusaurus a data-theme attribute.
  const html = document.documentElement, dark = matchMedia("(prefers-color-scheme: dark)");
  const theme = () => {
    const t = html.getAttribute("data-theme");
    if (t === "dark" || t === "light") return t;
    if (html.classList.contains("dark")) return "dark";
    if (html.classList.contains("light")) return "light";
    return dark.matches ? "dark" : "light";
  };
  const applyTheme = () => host.setAttribute("data-theme", theme());
  new MutationObserver(applyTheme).observe(html, { attributes: true, attributeFilter: ["class", "data-theme"] });
  dark.addEventListener("change", applyTheme);
  applyTheme();

  let info = null, sid = null, thread = null, model = null, busy = true, started = null;
  let leaving = false;  // a turn's fetch is cut off when the page unloads; that isn't a failure
  addEventListener("pagehide", () => { leaving = true; });
  addEventListener("pageshow", () => { leaving = false; });
  const save = () => saved.set({ sid, thread, model, log: msgs.innerHTML });
  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const setMeta = () => { meta.textContent = `${info.db_user} · ${info.user_id} · ${short(thread)}`; meta.title = thread || ""; };
  const setBusy = (b) => {
    busy = b;
    input.disabled = send.disabled = newBtn.disabled = b;
    // Back to the box after a turn, unless the reader has moved on to the page under the panel.
    if (!b) { save(); if (root.classList.contains("open") && [document.body, host].includes(document.activeElement)) input.focus(); }
  };

  function add(kind, who, text) {
    const m = el("div", "msg " + kind);
    if (who) m.append(el("div", "who", who));
    m.append(el("div", "text", text));
    msgs.append(m); scroll(); save();
    return m;
  }

  async function api(path, opts = {}) {
    const res = await fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.detail || res.statusText);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  async function startSession(reason) {
    const want = get(localStorage, MODEL_KEY);  // the model last chosen on the chat page
    let s;
    try {
      s = await (await api("/api/sessions", { method: "POST", body: JSON.stringify({ model: want }) })).json();
    } catch (e) {
      if (e.status !== 400) throw e;  // that model is gone: use the default
      s = await (await api("/api/sessions", { method: "POST", body: JSON.stringify({ model: null }) })).json();
    }
    sid = s.session_id; thread = s.thread_id; model = s.model;
    setMeta();
    add("note", null, (reason ? reason + " " : "") + `new thread ${short(thread)} · model ${model}`);
  }

  // The "why?" under a reply opens the inspector's why for that thread; the chat page shows its own.
  const bindWhy = (b) => { b.onclick = () => { location.href = `/runs/${b.dataset.thread || thread}?view=why`; }; };

  async function resume(prev) {
    // The same steps as the chat page's resume: the server finishes a turn a page left behind.
    if (!prev || !prev.sid) return false;
    let s, wait = null;
    try { s = await (await api(`/api/sessions/${prev.sid}`)).json(); } catch { return false; }
    sid = prev.sid; thread = s.thread_id; model = s.model;
    msgs.innerHTML = prev.log || "";
    msgs.querySelectorAll(".pending").forEach((n) => n.closest(".msg.note") ? n.closest(".msg").remove() : n.classList.remove("pending"));
    const lastMsg = msgs.lastElementChild;
    if (lastMsg && lastMsg.classList.contains("you")) {
      const asked = lastMsg.querySelector(".text").textContent;
      if (s.last && s.last.user_message === asked) {
        add("assistant", "companion", s.last.text)
          .append(el("div", "status", "finished while you were away; see Runs for what it remembered"));
      } else {
        wait = add("note", null, "the reply is still being written…");
        wait.querySelector(".text").classList.add("pending");
        wait._asked = asked;
      }
    }
    msgs.querySelectorAll(".status button.link").forEach(bindWhy);
    msgs.querySelectorAll(".status a").forEach((a) => a.removeAttribute("target"));  // the panel follows you
    setMeta(); scroll();
    if (wait) await waitForReply(wait);
    return true;
  }

  // Left mid-turn and came back before the server finished it: poll until the reply is there.
  async function waitForReply(note) {
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      let s;
      try { s = await (await api(`/api/sessions/${sid}`)).json(); } catch { break; }
      if (s.last && s.last.user_message === note._asked) {
        note.remove();
        add("assistant", "companion", s.last.text)
          .append(el("div", "status", "finished while you were away; see Runs for what it remembered"));
        return;
      }
    }
    const t = note.querySelector(".text");
    t.classList.remove("pending");
    t.textContent = "The reply didn't come back. Check Runs, or reload.";
    save();
  }

  function onRemembered(reply, ev) {
    const parts = ["created", "updated", "deleted"].filter((k) => ev[k]).map((k) => `${ev[k]} ${k}`);
    const s = reply._status;
    s.classList.remove("pending");
    s.textContent = `remembered in ${ev.seconds.toFixed(1)}s: ${parts.join(", ") || "nothing new"}`;
    const st = s.parentNode, t = reply._meta.thread_id;
    msgs.querySelectorAll(".status button.link").forEach((b) => b.remove());  // why explains only the last reply
    const why = el("button", "link", "why?");
    why.type = "button"; why.dataset.thread = t; bindWhy(why);
    st.append(why);
    if (ev.turn) {
      const link = (href, text) => { const a = el("a", null, text); a.href = href; return a; };
      st.append(link(`/runs/${t}?turn=${ev.turn}`, `turn ${ev.turn} in inspector`), link(`/runs/${t}/turn/${ev.turn}`, "lifecycle"));
    }
    save();
    window.dispatchEvent(new CustomEvent("companion:remembered", { detail: { thread_id: t, ...ev } }));
  }

  async function turn(text) {
    setBusy(true);
    add("you", "you", text);
    const pending = add("note", null, "thinking…");
    pending.querySelector(".text").classList.add("pending");
    save();
    let reply = null;
    try {
      let res;
      try {
        res = await api(`/api/sessions/${sid}/turns`, { method: "POST", body: JSON.stringify({ message: text }) });
      } catch (e) {
        if (e.status !== 404) throw e;
        await startSession("The server restarted, so this is a fresh session.");
        res = await api(`/api/sessions/${sid}/turns`, { method: "POST", body: JSON.stringify({ message: text }) });
      }
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "reply") {
            pending.remove();
            reply = add("assistant", ev.model === info.model ? "companion" : `companion · ${ev.model}`, ev.text);
            const st = el("div", "status");
            const s = el("span", "pending", `${ev.in_prompt} of ${ev.retrieved} memories in prompt · remembering…`);
            st.append(s); reply.append(st); scroll(); save();
            reply._status = s; reply._meta = ev;
          } else if (ev.type === "remembered") {
            onRemembered(reply, ev);
          } else if (ev.type === "error") {
            pending.remove();
            if (reply && reply._status) { reply._status.classList.remove("pending"); reply._status.textContent = "not remembered"; }
            add("error", null, `${ev.stage === "reply" ? "no reply" : "remembering failed"}: ${ev.message}`);
          }
        }
      }
    } catch (e) {
      // Leaving the page cuts the turn's fetch off, sometimes before pagehide. Wait a moment: if the
      // page is going away this never resumes, and the saved pending mark lets the next page pick the reply up.
      await new Promise((r) => setTimeout(r, 400));
      if (leaving) return;
      pending.remove();
      add("error", null, e.message);
    }
    setBusy(false);
  }

  async function newThread() {
    if (busy) return;
    setBusy(true);
    try {
      const s = await (await api(`/api/sessions/${sid}/new`, { method: "POST" })).json();
      thread = s.thread_id; setMeta();
      add("note", null, `new thread ${short(thread)}`);
    } catch (e) {
      if (e.status === 404) await startSession("The server restarted, so this is a fresh session.");
      else add("error", null, e.message);
    }
    setBusy(false);
  }

  // A session is made on first open, not on every page load, so browsing doesn't make threads.
  function start() {
    started = started || (async () => {
      try {
        if (!(await resume(saved.get()))) await startSession();
        setBusy(false);
      } catch (e) {
        add("error", null, `Can't reach the companion: ${e.message}`);
        started = null;
      }
    })();
    return started;
  }

  function setOpen(open, focus = true) {
    root.classList.toggle("open", open);
    launch.setAttribute("aria-expanded", String(open));
    put(sessionStorage, OPEN, open ? "1" : null);
    if (open) start().then(() => { scroll(); if (focus && !busy) input.focus(); });
    else if (focus) launch.focus();
  }

  function submit() {
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = ""; grow();
    if (text === "/new") return newThread();
    turn(text);
  }
  function grow() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; }

  launch.onclick = () => setOpen(true);
  close.onclick = () => setOpen(false);
  newBtn.onclick = newThread;
  form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  input.addEventListener("input", grow);
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
  input.disabled = send.disabled = newBtn.disabled = true;

  // Show the launcher only when the companion answers: the inspector also runs without it.
  (async () => {
    try { info = await (await api("/api/info")).json(); } catch { return; }
    document.body.append(host);
    if (get(sessionStorage, OPEN)) setOpen(true, false);  // open on the last page: keep it open, don't grab focus
  })();
})();
