/* OA Prep Tracker — all state lives in localStorage under KEY. */
(() => {
  "use strict";

  const DATA = window.QUESTION_DATA;
  const KEY = "oa-prep-tracker.v1";
  const QS = DATA.questions;
  const BY_ID = Object.fromEntries(QS.map((q) => [q.id, q]));
  const CATS = [{ id: "all", name: "All" }, ...DATA.categories];
  const CAT_NAME = Object.fromEntries(CATS.map((c) => [c.id, c.name]));
  const PAGE = 25;

  // ------------------------------------------------------------------ state
  const defaults = () => ({ goal: 30, shuffle: false, q: {}, sets: {}, cat: "all", mode: "today" });
  let S = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return { ...defaults(), ...JSON.parse(raw) };
    } catch (e) { /* storage blocked or corrupt */ }
    return defaults();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast("Could not save progress in this browser"); }
  }

  const today = () => dayKey(new Date());
  function dayKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function addDays(key, n) {
    const [y, m, d] = key.split("-").map(Number);
    return dayKey(new Date(y, m - 1, d + n));
  }

  const rec = (id) => S.q[id] || {};
  function setRec(id, patch) {
    const r = { ...rec(id), ...patch };
    Object.keys(r).forEach((k) => (r[k] === undefined || r[k] === null || r[k] === false) && delete r[k]);
    if (Object.keys(r).length) S.q[id] = r; else delete S.q[id];
    save();
  }

  // ----------------------------------------------------------- statistics
  function dailyCounts() {
    const c = {};
    for (const r of Object.values(S.q)) if (r.d) c[r.d] = (c[r.d] || 0) + 1;
    return c;
  }
  function streaks(counts) {
    const goal = S.goal;
    let cur = 0;
    let day = today();
    if ((counts[day] || 0) < goal) day = addDays(day, -1);
    while ((counts[day] || 0) >= goal) { cur++; day = addDays(day, -1); }
    let best = 0, run = 0, prev = null;
    for (const d of Object.keys(counts).filter((d) => counts[d] >= goal).sort()) {
      run = prev && addDays(prev, 1) === d ? run + 1 : 1;
      best = Math.max(best, run);
      prev = d;
    }
    return { cur, best: Math.max(best, cur) };
  }
  const pool = (cat) => (cat === "all" ? QS : QS.filter((q) => q.cat === cat));

  // --------------------------------------------------------- today's set
  function rng(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  }
  function orderedPending(cat, exclude) {
    const t = today();
    let list = pool(cat).filter((q) => !exclude.has(q.id) && !rec(q.id).d);
    if (S.shuffle) {
      const r = rng(t + cat + exclude.size);
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    } else if (cat === "all") {
      // Round-robin across categories so "All" is a real mix.
      const buckets = DATA.categories.map((c) => list.filter((q) => q.cat === c.id));
      const mixed = [];
      for (let i = 0; mixed.length < list.length; i++) for (const b of buckets) if (b[i]) mixed.push(b[i]);
      list = mixed;
    }
    return list;
  }
  function todaySet(cat) {
    const t = today();
    for (const k of Object.keys(S.sets)) if (!k.startsWith(t + "|")) delete S.sets[k];
    const key = `${t}|${cat}`;
    if (!S.sets[key]) {
      // Anything already done today in this category counts toward the set first.
      const doneToday = pool(cat).filter((q) => rec(q.id).d === t).map((q) => q.id);
      const fresh = orderedPending(cat, new Set()).map((q) => q.id);
      S.sets[key] = [...doneToday, ...fresh].slice(0, Math.max(S.goal, doneToday.length));
      save();
    }
    return S.sets[key].filter((id) => BY_ID[id]);
  }
  function extendSet(cat, n) {
    const key = `${today()}|${cat}`;
    const cur = new Set(S.sets[key] || []);
    S.sets[key] = [...cur, ...orderedPending(cat, cur).slice(0, n).map((q) => q.id)];
    save();
  }

  // ------------------------------------------------------------ rendering
  const $ = (s, el = document) => el.querySelector(s);
  const main = $("#main");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let browseState = { status: "all", topic: "", search: "", shown: PAGE };

  function renderHeader() {
    const counts = dailyCounts();
    const n = counts[today()] || 0;
    const frac = Math.min(1, n / S.goal);
    const circ = 2 * Math.PI * 19;
    const fg = $("#ringFg");
    fg.style.strokeDasharray = circ;
    fg.style.strokeDashoffset = circ * (1 - frac);
    $("#ring").classList.toggle("complete", n >= S.goal);
    $("#ringText").textContent = `${n}/${S.goal}`;
    $("#streak").textContent = streaks(counts).cur;
    $("#todayLabel").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  }

  function renderCats() {
    $("#cats").innerHTML = CATS.map((c) => {
      const p = pool(c.id);
      const done = p.filter((q) => rec(q.id).d).length;
      return `<button class="cat ${S.cat === c.id ? "active" : ""}" data-cat="${c.id}">${esc(c.name)} <span class="count">${done}/${p.length}</span></button>`;
    }).join("");
    document.querySelectorAll(".mode").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === S.mode);
      b.setAttribute("aria-selected", b.dataset.mode === S.mode);
    });
  }

  function cardState(q) {
    const r = rec(q.id);
    if (r.a !== undefined) return r.a === q.a ? "ok" : "bad";
    if (r.d) return "seen";
    return "";
  }

  function cardHTML(q, num) {
    const r = rec(q.id);
    const answered = r.a !== undefined;
    const revealed = answered || r.show;
    const st = cardState(q);
    const opts = q.o.map((o, i) => {
      let cls = "";
      if (revealed && i === q.a) cls = "correct";
      else if (answered && i === r.a) cls = "wrong";
      return `<button class="opt ${cls}" data-act="pick" data-i="${i}" ${revealed ? "disabled" : ""}><span class="letter">${"ABCD"[i]}</span><span class="otext">${o}</span></button>`;
    }).join("");
    let explain = "";
    if (revealed) {
      const verdict = answered
        ? (r.a === q.a ? `<span class="verdict ok">Correct.</span>` : `<span class="verdict bad">Not quite — answer is ${"ABCD"[q.a]}.</span>`)
        : `<span class="verdict">Answer: ${"ABCD"[q.a]}.</span>`;
      explain = `<div class="explain">${verdict} ${q.x || ""}</div>`;
    }
    return `<article class="card ${r.d ? "is-done" : ""} ${st === "bad" ? "is-wrong" : ""}" id="q-${q.id}" data-id="${q.id}">
      <div class="card-head">
        ${num ? `<span class="num">${num}.</span>` : ""}
        <span class="chip">${esc(CAT_NAME[q.cat])}</span>
        <span>${esc(q.topic)}</span>
        ${q.lvl ? `<span class="lvl">${esc(q.lvl)}</span>` : ""}
        <span class="spacer"></span>
        <span class="muted">${esc(q.src)}</span>
        <button class="star ${r.b ? "on" : ""}" data-act="star" title="Bookmark" aria-label="Bookmark">${r.b ? "★" : "☆"}</button>
        <label class="done-toggle"><input type="checkbox" data-act="done" ${r.d ? "checked" : ""}> Done</label>
      </div>
      <div class="stem">${q.q}</div>
      <div class="opts">${opts}</div>
      <div class="card-foot">
        ${revealed ? `<button class="linkish" data-act="retry">↺ Try again</button>` : `<button class="linkish" data-act="show">Show answer</button>`}
      </div>
      ${explain}
    </article>`;
  }

  function checklistHTML(ids) {
    return ids.map((id, i) => {
      const st = cardState(BY_ID[id]);
      return `<button class="tick ${st}" data-jump="${id}" title="Question ${i + 1}">${i + 1}</button>`;
    }).join("");
  }

  function renderToday() {
    const ids = todaySet(S.cat);
    if (!ids.length) {
      main.innerHTML = `<div class="panel empty">Every question in <b>${esc(CAT_NAME[S.cat])}</b> is done. 🎉<br>Pick another category, or untick some in Browse to revise them.</div>`;
      return;
    }
    main.innerHTML = todayPanelHTML(ids) + `<div id="cards">${ids.map((id, i) => cardHTML(BY_ID[id], i + 1)).join("")}</div>`;
  }

  function todayPanelHTML(ids) {
    const doneHere = ids.filter((id) => rec(id).d).length;
    const totalToday = dailyCounts()[today()] || 0;
    const remaining = pool(S.cat).filter((q) => !rec(q.id).d).length;
    const correct = ids.filter((id) => cardState(BY_ID[id]) === "ok").length;
    const answered = ids.filter((id) => rec(id).a !== undefined).length;
    return `
      <section class="panel" id="todayPanel">
        <div class="panel-head">
          <div>
            <h2>Today's set · ${esc(CAT_NAME[S.cat])}</h2>
            <div class="muted">${doneHere} of ${ids.length} done in this set · ${totalToday} of ${S.goal} done today overall${answered ? ` · ${correct}/${answered} correct` : ""}</div>
          </div>
          <div class="btn-row" style="margin:0">
            ${remaining ? `<button class="btn" data-act="more">+ 10 more</button>` : ""}
          </div>
        </div>
        <div class="bar" style="margin-top:10px"><span style="width:${(100 * doneHere) / ids.length}%"></span></div>
        <div class="checklist" id="checklist">${checklistHTML(ids)}</div>
        <div class="legend"><span><i style="background:var(--good)"></i>Correct</span><span><i style="background:var(--bad)"></i>Wrong</span><span><i style="background:var(--done)"></i>Marked done</span><span><i style="background:var(--surface-2);border:1px solid var(--border)"></i>To do</span></div>
        ${totalToday >= S.goal ? `<div class="celebrate">Daily goal reached — ${totalToday} questions today. Keep the streak going tomorrow!</div>` : ""}
      </section>`;
  }

  function browseList() {
    const { status, topic, search } = browseState;
    const s = search.trim().toLowerCase();
    return pool(S.cat).filter((q) => {
      const r = rec(q.id);
      if (status === "todo" && r.d) return false;
      if (status === "done" && !r.d) return false;
      if (status === "wrong" && !(r.a !== undefined && r.a !== q.a)) return false;
      if (status === "star" && !r.b) return false;
      if (topic && q.topic !== topic) return false;
      if (s && !(q.q + " " + q.o.join(" ") + " " + q.topic).toLowerCase().includes(s)) return false;
      return true;
    });
  }

  function renderBrowse() {
    const topics = [...new Set(pool(S.cat).map((q) => q.topic))];
    if (browseState.topic && !topics.includes(browseState.topic)) browseState.topic = "";
    const list = browseList();
    const shown = list.slice(0, browseState.shown);
    main.innerHTML = `
      <div class="filters">
        <select id="fStatus" aria-label="Status">
          ${[["all", "All questions"], ["todo", "Not done"], ["done", "Done"], ["wrong", "Answered wrong"], ["star", "Bookmarked"]]
            .map(([v, l]) => `<option value="${v}" ${browseState.status === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <select id="fTopic" aria-label="Topic">
          <option value="">All topics (${topics.length})</option>
          ${topics.map((t) => `<option ${browseState.topic === t ? "selected" : ""}>${esc(t)}</option>`).join("")}
        </select>
        <input id="fSearch" type="search" placeholder="Search questions…" value="${esc(browseState.search)}">
      </div>
      <p class="result-count">${list.length} question${list.length === 1 ? "" : "s"}</p>
      <div id="cards">${shown.length ? shown.map((q) => cardHTML(q)).join("") : `<div class="empty">No questions match these filters.</div>`}</div>
      ${list.length > shown.length ? `<div style="text-align:center"><button class="btn" data-act="showmore">Show more (${list.length - shown.length} left)</button></div>` : ""}`;
  }

  function renderProgress() {
    const counts = dailyCounts();
    const t = today();
    const { cur, best } = streaks(counts);
    const recs = Object.entries(S.q);
    const doneAll = recs.filter(([, r]) => r.d).length;
    const answered = recs.filter(([id, r]) => r.a !== undefined && BY_ID[id]);
    const right = answered.filter(([id, r]) => r.a === BY_ID[id].a).length;
    const daysMet = Object.values(counts).filter((c) => c >= S.goal).length;

    // Heatmap: 26 weeks ending this week, columns are weeks (Mon..Sun rows).
    const now = new Date();
    const dow = (now.getDay() + 6) % 7;
    const start = addDays(t, -(25 * 7 + dow));
    let cells = "";
    for (let i = 0; i < 26 * 7; i++) {
      const d = addDays(start, i);
      const c = counts[d] || 0;
      const lvl = c === 0 ? "" : c >= S.goal ? "l3" : c >= S.goal / 2 ? "l2" : "l1";
      const fut = d > t ? "future" : "";
      cells += `<i class="${lvl} ${fut} ${d === t ? "today" : ""}" title="${d}: ${c} done"></i>`;
    }

    const rows = DATA.categories.map((c) => {
      const p = pool(c.id);
      const done = p.filter((q) => rec(q.id).d).length;
      const ans = p.filter((q) => rec(q.id).a !== undefined);
      const ok = ans.filter((q) => rec(q.id).a === q.a).length;
      const pct = p.length ? Math.round((100 * done) / p.length) : 0;
      return `<tr><td>${esc(c.name)}</td><td class="barcell"><div class="bar"><span style="width:${pct}%"></span></div></td>
        <td class="num">${done}/${p.length}</td><td class="num">${pct}%</td><td class="num">${ans.length ? Math.round((100 * ok) / ans.length) + "%" : "—"}</td></tr>`;
    }).join("");

    let days = "";
    for (let i = 13; i >= 0; i--) {
      const d = addDays(t, -i);
      const c = counts[d] || 0;
      const label = new Date(d + "T00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      days += `<div class="day ${c >= S.goal ? "met" : ""}"><span class="muted">${label}</span><b>${c}${c >= S.goal ? " ✓" : ""}</b></div>`;
    }

    main.innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="v">${counts[t] || 0}/${S.goal}</div><div class="l">Done today</div></div>
        <div class="kpi"><div class="v">${cur}</div><div class="l">Current streak (days)</div></div>
        <div class="kpi"><div class="v">${best}</div><div class="l">Best streak</div></div>
        <div class="kpi"><div class="v">${doneAll}/${QS.length}</div><div class="l">Questions done</div></div>
        <div class="kpi"><div class="v">${answered.length ? Math.round((100 * right) / answered.length) + "%" : "—"}</div><div class="l">Accuracy (${answered.length} answered)</div></div>
        <div class="kpi"><div class="v">${daysMet}</div><div class="l">Days goal met</div></div>
      </div>
      <section class="panel">
        <h2>Daily habit — last 26 weeks</h2>
        <p class="muted" style="margin:0 0 10px;font-size:13px">Darkest = goal of ${S.goal} met.</p>
        <div class="heat-wrap"><div class="heat">${cells}</div></div>
      </section>
      <section class="panel">
        <h2>Last 14 days</h2>
        <div class="days">${days}</div>
      </section>
      <section class="panel">
        <h2>By category</h2>
        <table class="cat-table">
          <tr><th>Category</th><th class="barcell"></th><th class="num">Done</th><th class="num">%</th><th class="num">Accuracy</th></tr>
          ${rows}
        </table>
      </section>`;
  }

  function render() {
    renderHeader();
    renderCats();
    if (S.mode === "browse") renderBrowse();
    else if (S.mode === "progress") renderProgress();
    else renderToday();
  }

  // Re-render a single card plus the counters, keeping scroll position.
  function refreshCard(id) {
    const el = document.getElementById("q-" + id);
    if (el) {
      const num = el.querySelector(".num");
      el.outerHTML = cardHTML(BY_ID[id], num ? parseInt(num.textContent, 10) : 0);
    }
    renderHeader();
    renderCats();
    const panel = $("#todayPanel");
    if (S.mode === "today" && panel) panel.outerHTML = todayPanelHTML(todaySet(S.cat));
  }

  // --------------------------------------------------------------- events
  document.addEventListener("click", (e) => {
    const cat = e.target.closest("[data-cat]");
    if (cat) { S.cat = cat.dataset.cat; browseState.shown = PAGE; save(); render(); window.scrollTo(0, 0); return; }
    const mode = e.target.closest("[data-mode]");
    if (mode) { S.mode = mode.dataset.mode; save(); render(); return; }
    const jump = e.target.closest("[data-jump]");
    if (jump) { document.getElementById("q-" + jump.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }

    const act = e.target.closest("[data-act]");
    if (!act) return;
    const a = act.dataset.act;
    if (a === "more") { extendSet(S.cat, 10); render(); return; }
    if (a === "showmore") { browseState.shown += PAGE; renderBrowse(); return; }

    const card = act.closest(".card");
    if (!card) return;
    const id = card.dataset.id;
    const r = rec(id);
    if (a === "pick") {
      setRec(id, { a: Number(act.dataset.i), d: r.d || today(), show: undefined });
    } else if (a === "show") {
      setRec(id, { show: true });
    } else if (a === "retry") {
      setRec(id, { a: undefined, show: undefined });
    } else if (a === "star") {
      setRec(id, { b: r.b ? undefined : 1 });
    } else if (a === "done") {
      setRec(id, { d: act.checked ? today() : undefined });
    } else return;
    refreshCard(id);
  });

  main.addEventListener("change", (e) => {
    if (e.target.id === "fStatus") { browseState.status = e.target.value; browseState.shown = PAGE; renderBrowse(); }
    if (e.target.id === "fTopic") { browseState.topic = e.target.value; browseState.shown = PAGE; renderBrowse(); }
  });
  let searchTimer;
  main.addEventListener("input", (e) => {
    if (e.target.id !== "fSearch") return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      browseState.search = e.target.value;
      browseState.shown = PAGE;
      renderBrowse();
      const box = $("#fSearch");
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }, 200);
  });

  // ------------------------------------------------------------- settings
  const dlg = $("#settings");
  $("#settingsBtn").addEventListener("click", () => {
    $("#goalInput").value = S.goal;
    $("#shuffleInput").checked = S.shuffle;
    dlg.showModal();
  });
  $("#goalInput").addEventListener("change", (e) => {
    const v = Math.max(1, Math.min(300, parseInt(e.target.value, 10) || 30));
    S.goal = v;
    S.sets = {}; // rebuild today's sets with the new size (done questions stay done)
    save(); render();
  });
  $("#shuffleInput").addEventListener("change", (e) => { S.shuffle = e.target.checked; S.sets = {}; save(); render(); });
  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(S, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `oa-prep-progress-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#importInput").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (!obj || typeof obj.q !== "object") throw new Error("bad file");
      if (!confirm("Replace your current progress with this backup?")) return;
      S = { ...defaults(), ...obj };
      save(); render(); dlg.close(); toast("Backup imported");
    } catch (err) { toast("That file is not a valid backup"); }
    e.target.value = "";
  });
  $("#resetBtn").addEventListener("click", () => {
    if (!confirm("Delete ALL progress, streaks and bookmarks? Export a backup first if unsure.")) return;
    S = defaults(); save(); render(); dlg.close(); toast("Progress reset");
  });

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  // Roll over to a new day if the tab stays open past midnight.
  let lastDay = today();
  setInterval(() => { if (today() !== lastDay) { lastDay = today(); render(); } }, 60000);

  render();
})();
