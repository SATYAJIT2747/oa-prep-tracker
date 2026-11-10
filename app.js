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

  // opt.test: render inside a test, using the test's own answer (opt.chosen).
  function cardHTML(q, num, opt = {}) {
    const r0 = rec(q.id);
    const r = opt.test ? { ...r0, a: opt.chosen, show: opt.reveal } : r0;
    const answered = r.a !== undefined;
    const revealed = answered || r.show;
    const st = opt.test ? (answered ? (r.a === q.a ? "ok" : "bad") : "") : cardState(q);
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
    const doneCls = opt.test ? (st === "ok" ? "is-done" : "") : r.d ? "is-done" : "";
    return `<article class="card ${doneCls} ${st === "bad" ? "is-wrong" : ""}" id="q-${q.id}" data-id="${q.id}" ${opt.test ? 'data-test="1"' : ""}>
      <div class="card-head">
        ${num ? `<span class="num">${num}.</span>` : ""}
        <span class="chip">${esc(CAT_NAME[q.cat])}</span>
        <span>${esc(q.topic)}</span>
        ${q.lvl ? `<span class="lvl">${esc(q.lvl)}</span>` : ""}
        <span class="spacer"></span>
        <span class="muted">${esc(q.src)}</span>
        <button class="star ${r.b ? "on" : ""}" data-act="star" title="Bookmark" aria-label="Bookmark">${r.b ? "★" : "☆"}</button>
        ${opt.test ? "" : `<label class="done-toggle"><input type="checkbox" data-act="done" ${r.d ? "checked" : ""}> Done</label>`}
      </div>
      <div class="stem">${q.q}</div>
      <div class="opts">${opts}</div>
      ${opt.test ? "" : `<div class="card-foot">
        ${revealed ? `<button class="linkish" data-act="retry">↺ Try again</button>` : `<button class="linkish" data-act="show">Show answer</button>`}
      </div>`}
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

  // ----------------------------------------------------------------- test
  const FROM = [["new", "Not done yet"], ["any", "Any question"], ["wrong", "My wrong answers"], ["star", "Bookmarked"]];
  const cfg = () => (S.testCfg ||= { cats: ["aptitude", "stats"], n: 30, from: "new" });

  function testPool(c) {
    const cats = new Set(c.cats);
    return QS.filter((q) => {
      if (!cats.has(q.cat)) return false;
      const r = rec(q.id);
      if (c.from === "new") return !r.d;
      if (c.from === "wrong") return r.a !== undefined && r.a !== q.a;
      if (c.from === "star") return !!r.b;
      return true;
    });
  }
  const shuffled = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const fmtTime = (ms) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
  };
  const testElapsed = (T) => (T.dur !== undefined ? T.dur : Date.now() - T.start);

  function startTest(ids, cats) {
    S.test = { ids, ans: {}, cur: 0, start: Date.now(), cats };
    save();
    render();
    window.scrollTo(0, 0);
  }

  function renderTest() {
    const T = S.test;
    if (T && T.done) return renderTestResult(T);
    if (T) return renderTestRun(T);
    renderTestSetup();
  }

  function renderTestSetup() {
    const c = cfg();
    const avail = testPool(c).length;
    const todayN = dailyCounts()[today()] || 0;
    const picks = DATA.categories.map((k) => {
      const on = c.cats.includes(k.id);
      const n = testPool({ ...c, cats: [k.id] }).length;
      return `<label class="pick ${on ? "on" : ""}"><input type="checkbox" data-tcat="${k.id}" ${on ? "checked" : ""}><span>${esc(k.name)}</span><span class="count">${n}</span></label>`;
    }).join("");
    const hist = (S.tests || []).slice(-8).reverse().map((h) => `<tr>
        <td>${esc(h.date)}</td><td>${esc(h.cats.map((k) => CAT_NAME[k]).join(", "))}</td>
        <td class="num">${h.correct}/${h.n}</td><td class="num">${h.n ? Math.round((100 * h.correct) / h.n) : 0}%</td><td class="num">${fmtTime(h.dur)}</td></tr>`).join("");
    main.innerHTML = `
      <section class="panel">
        <h2>Build a test</h2>
        <p class="muted" style="margin:0 0 12px">Pick the topics you want today. Questions are shuffled and every answer counts toward your daily goal (${todayN}/${S.goal} done today).</p>
        <div class="pick-grid">${picks}</div>
        <div class="btn-row"><button class="btn" data-act="tall">Select all</button><button class="btn" data-act="tnone">Clear</button></div>
        <div class="setup">
          <label>Number of questions
            <span class="num-row"><input type="number" id="tN" min="1" max="${QS.length}" value="${c.n}">
            ${[10, 30, 50, 100].map((n) => `<button class="btn small ${c.n === n ? "primary" : ""}" data-act="tnum" data-n="${n}">${n}</button>`).join("")}</span>
          </label>
          <label>Questions from
            <select id="tFrom">${FROM.map(([v, l]) => `<option value="${v}" ${c.from === v ? "selected" : ""}>${l}</option>`).join("")}</select>
          </label>
        </div>
        ${c.n < S.goal ? `<p class="warn-note">Your daily target is at least ${S.goal}. You can still run a shorter test.</p>` : ""}
        <p class="muted">${avail} question${avail === 1 ? "" : "s"} available${avail && avail < c.n ? ` (the test will have ${avail})` : ""}.</p>
        <button class="btn primary big" data-act="tstart" ${avail ? "" : "disabled"}>Start test →</button>
      </section>
      ${hist ? `<section class="panel"><h2>Recent tests</h2>
        <table class="cat-table"><tr><th>Date</th><th>Topics</th><th class="num">Score</th><th class="num">%</th><th class="num">Time</th></tr>${hist}</table></section>` : ""}`;
  }

  function renderTestRun(T) {
    const q = BY_ID[T.ids[T.cur]];
    const answered = Object.keys(T.ans).length;
    const correct = T.ids.filter((id) => T.ans[id] === BY_ID[id].a).length;
    const ticks = T.ids.map((id, i) => {
      const a = T.ans[id];
      const st = a === undefined ? "" : a === BY_ID[id].a ? "ok" : "bad";
      return `<button class="tick ${st} ${i === T.cur ? "cur" : ""}" data-tgo="${i}">${i + 1}</button>`;
    }).join("");
    main.innerHTML = `
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Test · ${esc(T.cats.map((k) => CAT_NAME[k]).join(", "))}</h2>
            <div class="muted">${answered}/${T.ids.length} answered · ${correct} correct · ⏱ <span id="tTimer">${fmtTime(testElapsed(T))}</span></div>
          </div>
          <div class="btn-row" style="margin:0">
            <button class="btn" data-act="tquit">Quit</button>
            <button class="btn primary" data-act="tfinish">Finish test</button>
          </div>
        </div>
        <div class="bar" style="margin-top:10px"><span style="width:${(100 * answered) / T.ids.length}%"></span></div>
        <div class="checklist">${ticks}</div>
      </section>
      ${cardHTML(q, T.cur + 1, { test: true, chosen: T.ans[q.id] })}
      <div class="test-nav">
        <button class="btn" data-act="tprev" ${T.cur === 0 ? "disabled" : ""}>← Previous</button>
        <span class="muted">${T.cur + 1} / ${T.ids.length} · keys 1–4 answer, ← → move</span>
        ${T.cur < T.ids.length - 1 ? `<button class="btn primary" data-act="tnext">Next →</button>` : `<button class="btn primary" data-act="tfinish">Finish test</button>`}
      </div>`;
  }

  function renderTestResult(T) {
    const n = T.ids.length;
    const correct = T.ids.filter((id) => T.ans[id] === BY_ID[id].a).length;
    const wrongIds = T.ids.filter((id) => T.ans[id] !== undefined && T.ans[id] !== BY_ID[id].a);
    const skipped = T.ids.filter((id) => T.ans[id] === undefined);
    const rows = T.cats.map((k) => {
      const ids = T.ids.filter((id) => BY_ID[id].cat === k);
      if (!ids.length) return "";
      const ok = ids.filter((id) => T.ans[id] === BY_ID[id].a).length;
      return `<tr><td>${esc(CAT_NAME[k])}</td><td class="barcell"><div class="bar"><span style="width:${(100 * ok) / ids.length}%"></span></div></td><td class="num">${ok}/${ids.length}</td><td class="num">${Math.round((100 * ok) / ids.length)}%</td></tr>`;
    }).join("");
    const review = T.showAll ? T.ids : [...wrongIds, ...skipped];
    main.innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="v">${correct}/${n}</div><div class="l">Score</div></div>
        <div class="kpi"><div class="v">${Math.round((100 * correct) / n)}%</div><div class="l">Accuracy</div></div>
        <div class="kpi"><div class="v">${fmtTime(T.dur)}</div><div class="l">Time (${fmtTime(T.dur / n)} per question)</div></div>
        <div class="kpi"><div class="v">${wrongIds.length} / ${skipped.length}</div><div class="l">Wrong / skipped</div></div>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>Result by topic</h2>
          <div class="btn-row" style="margin:0">
            ${wrongIds.length + skipped.length ? `<button class="btn" data-act="tretake">Retake wrong & skipped (${wrongIds.length + skipped.length})</button>` : ""}
            <button class="btn primary" data-act="tnew">New test</button>
          </div>
        </div>
        <table class="cat-table">${rows}</table>
      </section>
      <div class="panel-head" style="margin:4px 0 10px">
        <h2 style="font-size:16px;margin:0">${T.showAll ? "All questions" : review.length ? "Review your mistakes" : "Perfect score — nothing to review 🎉"}</h2>
        <button class="linkish" data-act="tshowall">${T.showAll ? "Show only mistakes" : "Show all questions"}</button>
      </div>
      ${review.map((id) => cardHTML(BY_ID[id], T.ids.indexOf(id) + 1, { test: true, chosen: T.ans[id], reveal: true })).join("")}`;
  }

  function finishTest() {
    const T = S.test;
    const left = T.ids.length - Object.keys(T.ans).length;
    if (left && !confirm(`${left} question${left === 1 ? " is" : "s are"} unanswered. Finish anyway?`)) return;
    T.done = true;
    T.dur = Date.now() - T.start;
    const correct = T.ids.filter((id) => T.ans[id] === BY_ID[id].a).length;
    (S.tests ||= []).push({ date: today(), cats: T.cats, n: T.ids.length, correct, dur: T.dur });
    if (S.tests.length > 100) S.tests.shift();
    save();
    render();
    window.scrollTo(0, 0);
  }

  function testAction(a, el) {
    const c = cfg();
    const T = S.test;
    switch (a) {
      case "tall": c.cats = DATA.categories.map((k) => k.id); break;
      case "tnone": c.cats = []; break;
      case "tnum": c.n = Number(el.dataset.n); break;
      case "tstart": {
        const ids = shuffled(testPool(c).map((q) => q.id)).slice(0, c.n);
        if (ids.length) startTest(ids, [...c.cats]);
        return;
      }
      case "tprev": T.cur = Math.max(0, T.cur - 1); break;
      case "tnext": T.cur = Math.min(T.ids.length - 1, T.cur + 1); break;
      case "tfinish": finishTest(); return;
      case "tquit":
        if (!confirm("Quit this test? Answers you already gave still count toward today.")) return;
        S.test = null; break;
      case "tnew": S.test = null; break;
      case "tshowall": T.showAll = !T.showAll; break;
      case "tretake": {
        const ids = shuffled(T.ids.filter((id) => T.ans[id] !== BY_ID[id].a));
        startTest(ids, T.cats);
        return;
      }
      default: return;
    }
    save();
    render();
    if (a === "tprev" || a === "tnext") window.scrollTo(0, 0);
  }

  function testPick(id, i) {
    const T = S.test;
    if (!T || T.done || T.ans[id] !== undefined) return;
    T.ans[id] = i;
    const r = rec(id);
    setRec(id, { a: i, d: r.d || today(), show: undefined }); // also saves S.test
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  function render() {
    renderHeader();
    renderCats();
    $("#cats").hidden = S.mode === "test";
    if (S.mode === "test") renderTest();
    else if (S.mode === "browse") renderBrowse();
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

    const tgo = e.target.closest("[data-tgo]");
    if (tgo && S.test) { S.test.cur = Number(tgo.dataset.tgo); save(); render(); return; }

    const act = e.target.closest("[data-act]");
    if (!act) return;
    const a = act.dataset.act;
    if (a.startsWith("t") && a !== "tick") { testAction(a, act); return; }
    if (a === "pick" && act.closest("[data-test]")) { testPick(act.closest(".card").dataset.id, Number(act.dataset.i)); return; }
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
    const tcat = e.target.dataset.tcat;
    if (tcat) {
      const c = cfg();
      c.cats = e.target.checked ? [...new Set([...c.cats, tcat])] : c.cats.filter((k) => k !== tcat);
      // Keep the category order stable.
      c.cats = DATA.categories.map((k) => k.id).filter((k) => c.cats.includes(k));
      save(); renderTest(); return;
    }
    if (e.target.id === "tN") { cfg().n = Math.max(1, Math.min(QS.length, parseInt(e.target.value, 10) || 30)); save(); renderTest(); return; }
    if (e.target.id === "tFrom") { cfg().from = e.target.value; save(); renderTest(); return; }
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

  // Keyboard shortcuts while a test is running.
  document.addEventListener("keydown", (e) => {
    const T = S.test;
    if (S.mode !== "test" || !T || T.done || e.ctrlKey || e.metaKey || e.altKey) return;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) || document.querySelector("dialog[open]")) return;
    const k = e.key.toLowerCase();
    const idx = "1234".indexOf(k) >= 0 ? "1234".indexOf(k) : "abcd".indexOf(k);
    if (idx >= 0) { testPick(T.ids[T.cur], idx); e.preventDefault(); }
    else if (k === "arrowright" || k === "enter") { if (T.cur < T.ids.length - 1) testAction("tnext"); e.preventDefault(); }
    else if (k === "arrowleft") { testAction("tprev"); e.preventDefault(); }
  });

  // Roll over to a new day if the tab stays open past midnight; tick the test timer.
  let lastDay = today();
  setInterval(() => { if (today() !== lastDay) { lastDay = today(); render(); } }, 60000);
  setInterval(() => {
    const el = document.getElementById("tTimer");
    if (el && S.test && !S.test.done) el.textContent = fmtTime(testElapsed(S.test));
  }, 1000);

  render();
})();
