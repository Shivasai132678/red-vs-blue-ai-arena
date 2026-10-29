/*
 * Red vs Blue · AI Security Combat Simulation (front end)
 *
 * The server runs the whole battle and returns every round's real result.
 * This script only plays those results back as animation. It never decides
 * a block, a bypass, damage, or the winner itself.
 */
(() => {
  "use strict";

  const TOTAL_ROUNDS = 10;
  const TOTAL_HP = 100;
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SPEED = REDUCED_MOTION ? 0.2 : 1; // shorter pauses when motion is reduced

  const LAYER_MESSAGES = {
    blocklist: "Custom blocklist stopped the attack.",
    prompt_shield_user: "Prompt Shields blocked the attack.",
    prompt_shield_doc: "Prompt Shields blocked a hidden instruction in the document.",
    content_filter: "Foundry content filter blocked harmful content.",
  };
  const CATEGORY_LABELS = {
    jailbreak: "Jailbreak",
    indirect: "Indirect injection",
    extraction: "Secret extraction",
    harmful: "Harmful content",
  };
  const CANCEL = Symbol("cancel");

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const minus = "−";

  // ---------- state ----------
  const state = {
    phase: "ready", // ready | loading | running | paused | complete | error
    runId: 0,
    paused: false,
    resumeFn: null,
    data: null,
  };

  // Pausable sequencing. Each step checks the run id, so a rematch or
  // cancel stops the old timeline without leaving stray timers behind.
  function gate(run) {
    if (!state.paused) return Promise.resolve();
    return new Promise((resolve) => { state.resumeFn = resolve; })
      .then(() => {
        if (run !== state.runId) throw CANCEL;
        return gate(run);
      });
  }

  async function step(ms, run) {
    await gate(run);
    if (run !== state.runId) throw CANCEL;
    await new Promise((resolve) => setTimeout(resolve, ms * SPEED));
    if (run !== state.runId) throw CANCEL;
  }

  function setPaused(value) {
    state.paused = value;
    if (!value && state.resumeFn) {
      const resume = state.resumeFn;
      state.resumeFn = null;
      resume();
    }
  }

  function cancelRun() {
    state.runId += 1;
    setPaused(false);
  }

  // ---------- phase and controls ----------
  const PHASE_UI = {
    ready:    { pill: "READY",          primary: "START BATTLE",  reportEnabled: false, data: "ready" },
    loading:  { pill: "LOADING",        primary: "STARTING…",     reportEnabled: false, data: "running" },
    running:  { pill: "IN PROGRESS",    primary: "PAUSE BATTLE",  reportEnabled: false, data: "running" },
    paused:   { pill: "PAUSED",         primary: "RESUME BATTLE", reportEnabled: false, data: "paused" },
    complete: { pill: "MATCH COMPLETE", primary: "REMATCH",       reportEnabled: true,  data: "complete" },
    error:    { pill: "ERROR",          primary: "START BATTLE",  reportEnabled: false, data: "error" },
  };

  function setPhase(phase) {
    state.phase = phase;
    const ui = PHASE_UI[phase];
    const pill = $("match-status");
    pill.textContent = ui.pill;
    pill.dataset.state = ui.data;
    const primary = $("primary-btn");
    primary.textContent = ui.primary;
    primary.disabled = phase === "loading";
    $("report-btn").disabled = !ui.reportEnabled;
    $("sum-report").disabled = !ui.reportEnabled;
  }

  function setRoundIndicator(current) {
    const n = String(current).padStart(2, "0");
    const t = String(TOTAL_ROUNDS).padStart(2, "0");
    $("round-indicator").textContent = `ROUND ${n} / ${t}`;
  }

  // ---------- panels ----------
  function setHp(side, hp) {
    const fill = $(`${side}-hp`);
    fill.style.width = `${(hp / TOTAL_HP) * 100}%`;
    fill.setAttribute("aria-valuenow", String(hp));
    $(`${side}-hp-text`).textContent = `${hp} / ${TOTAL_HP}`;
  }

  function popDamage(side, amount) {
    const wrap = $(`${side}-hp`).parentElement;
    const pop = el("span", "dmg-pop", `${minus}${amount}`);
    wrap.appendChild(pop);
    pop.addEventListener("animationend", () => pop.remove(), { once: true });
  }

  function hitPanel(side) {
    const panel = $(`${side}-panel`);
    panel.classList.remove("hit");
    void panel.offsetWidth; // restart the animation
    panel.classList.add("hit");
    panel.addEventListener("animationend", () => panel.classList.remove("hit"), { once: true });
  }

  function updateStats(rounds, upTo) {
    let blocked = 0;
    let bypassed = 0;
    for (let i = 0; i <= upTo; i += 1) {
      if (rounds[i].blocked) blocked += 1;
      else bypassed += 1;
    }
    $("red-success").textContent = String(bypassed);
    $("red-blocked").textContent = String(blocked);
    $("blue-blocked").textContent = String(blocked);
    $("blue-bypassed").textContent = String(bypassed);
  }

  // ---------- round card ----------
  function setRoundCard({ round, attackName, prompt, stateText, defense, outcome, outcomeClass, damage, message }) {
    if (round !== undefined) $("rc-round").textContent = `ROUND ${String(round).padStart(2, "0")} / ${String(TOTAL_ROUNDS).padStart(2, "0")}`;
    if (stateText !== undefined) $("rc-state").textContent = stateText;
    if (attackName !== undefined) $("rc-attack").textContent = attackName;
    if (prompt !== undefined) $("rc-prompt").textContent = prompt;
    if (defense !== undefined) $("rc-defense").textContent = defense;
    if (outcome !== undefined) {
      const node = $("rc-outcome");
      node.textContent = outcome;
      node.className = outcomeClass || "";
    }
    if (damage !== undefined) $("rc-damage").textContent = damage;
    if (message !== undefined) $("rc-message").textContent = message;
  }

  // ---------- lane ----------
  function resetLane() {
    const projectile = $("projectile");
    projectile.style.transition = "none";
    projectile.style.left = "6%";
    projectile.classList.remove("show");
    void projectile.offsetWidth;
    projectile.style.transition = "";

    $("barrier").classList.remove("engaged", "flicker");
    $("impact").classList.remove("show");
    $("callout").classList.remove("show", "blocked", "bypassed");
    $("burst").replaceChildren();
  }

  function spawnBurst() {
    const burst = $("burst");
    burst.replaceChildren();
    // Fixed directions keep the effect calm and repeatable.
    const directions = [
      [-26, -18], [-14, -30], [4, -34], [22, -20],
      [28, 4], [14, 22], [-6, 26], [-24, 12],
    ];
    directions.forEach(([dx, dy]) => {
      const p = el("span", "p");
      p.style.setProperty("--dx", `${dx}px`);
      p.style.setProperty("--dy", `${dy}px`);
      burst.appendChild(p);
    });
  }

  function showCallout(text, kind, position) {
    const callout = $("callout");
    callout.textContent = text;
    callout.className = `callout ${kind}`;
    callout.style.left = `${position}%`;
    void callout.offsetWidth;
    callout.classList.add("show");
  }

  // ---------- log ----------
  function currentFilter() {
    return $("log-filter").value;
  }

  function applyFilter() {
    const filter = currentFilter();
    $("log").querySelectorAll(".log-row").forEach((row) => {
      row.hidden = filter !== "all" && row.dataset.outcome !== filter;
    });
  }
  function appendLogRow(r, damageText) {
    $("log-empty").hidden = true;
    const log = $("log");
    const row = el("div", "log-row" + (r.blocked ? "" : " is-bypass"));
    row.dataset.outcome = r.blocked ? "blocked" : "bypassed";
    row.hidden = currentFilter() !== "all" && row.dataset.outcome !== currentFilter();
    row.appendChild(el("span", "r-num", `R${String(r.round).padStart(2, "0")}`));
    const atk = el("span", "atk", r.attack.name);
    row.appendChild(atk);
    row.appendChild(el("span", "r-def", r.layer_label || "No layer triggered"));
    row.appendChild(el("span", `tag r-tag ${r.blocked ? "blocked" : "bypassed"}`, r.blocked ? "BLOCKED" : "BYPASSED"));
    row.appendChild(el("span", "dmg", damageText));
    log.appendChild(row);
    $("log-count").textContent = `${log.querySelectorAll(".log-row").length} events`;
    log.scrollTop = log.scrollHeight; // scroll only the log, never the page
  }

  // ---------- round tracker ----------
  function buildTracker() {
    const list = $("tracker");
    list.replaceChildren();
    for (let i = 1; i <= TOTAL_ROUNDS; i += 1) {
      const item = el("li", "t-item", String(i));
      item.dataset.state = "pending";
      list.appendChild(item);
    }
  }

  function setTracker(index, stateName) {
    const item = $("tracker").children[index];
    if (item) item.dataset.state = stateName;
  }

  // ---------- round sequence ----------
  async function playRound(index, run) {
    const rounds = state.data.rounds;
    const r = rounds[index];
    const prev = index === 0 ? { red_hp: TOTAL_HP, blue_hp: TOTAL_HP } : rounds[index - 1];
    const redLoss = prev.red_hp - r.red_hp;
    const blueLoss = prev.blue_hp - r.blue_hp;
    const outcomeText = r.blocked ? "BLOCKED" : "BYPASSED";
    const outcomeClass = r.blocked ? "blocked" : "bypassed";
    const damageText = r.blocked ? `Red ${minus}${redLoss} HP` : `Blue ${minus}${blueLoss} HP`;

    resetLane();
    setTracker(index, "current");
    setRoundIndicator(r.round);

    // 1. Announce the round and the attack type.
    setRoundCard({
      round: r.round,
      stateText: "ATTACK DETECTED",
      attackName: r.attack.name,
      prompt: r.attack.document ? `${r.attack.prompt}  [document attached]` : r.attack.prompt,
      defense: "Scanning input…",
      outcome: "—",
      outcomeClass: "",
      damage: "—",
      message: "",
    });
    $("red-status").textContent = `Launching: ${r.attack.name}`;
    $("blue-status").textContent = "Scanning incoming input";
    await step(450, run);

    // 2. Attack travels toward the defense barrier.
    $("projectile").classList.add("show");
    $("projectile").style.left = "62%";
    await step(500, run);

    // 3. Outcome at the barrier, or the attack passes through.
    if (r.blocked) {
      $("barrier").classList.add("engaged");
      $("projectile").classList.remove("show");
      spawnBurst();
      showCallout("BLOCKED", "blocked", 62);
      $("blue-status").textContent = r.layer_label;
      $("red-status").textContent = `Stopped: ${r.attack.name}`;
    } else {
      $("projectile").style.left = "92%";
      await step(380, run);
      $("projectile").classList.remove("show");
      $("impact").classList.remove("show");
      void $("impact").offsetWidth;
      $("impact").classList.add("show");
      $("barrier").classList.add("flicker");
      showCallout("GUARDRAIL BYPASSED", "bypassed", 76);
      $("blue-status").textContent = "No layer triggered";
      $("red-status").textContent = `Success: ${r.attack.name}`;
    }
    await step(360, run);

    // 4. Apply the real HP values from the server.
    setTracker(index, r.blocked ? "blocked" : "bypassed");
    setHp("red", r.red_hp);
    setHp("blue", r.blue_hp);
    if (redLoss > 0) { popDamage("red", redLoss); hitPanel("red"); }
    if (blueLoss > 0) { popDamage("blue", blueLoss); hitPanel("blue"); }
    updateStats(rounds, index);

    // 5. Result text and event log.
    const message = r.blocked
      ? (LAYER_MESSAGES[r.layer] || "Defense blocked the attack.")
      : `Attack bypassed defenses. Blue AI takes ${blueLoss} damage.`;
    setRoundCard({
      stateText: r.blocked ? "DEFENSE HELD" : "DEFENSE BREACHED",
      defense: r.layer_label || "No layer triggered",
      outcome: outcomeText,
      outcomeClass,
      damage: damageText,
      message,
    });
    appendLogRow(r, damageText);
    await step(650, run);
  }

  async function playBattle(run) {
    const rounds = state.data.rounds;
    for (let i = 0; i < rounds.length; i += 1) {
      await playRound(i, run);
    }
    finishBattle(run);
  }

  function finishBattle(run) {
    if (run !== state.runId) return;
    const rounds = state.data.rounds;
    const last = rounds[rounds.length - 1];
    const winner = state.data.winner;

    resetLane();
    setPhase("complete");
    $("round-card").hidden = true;
    $("red-status").textContent = "Battle over";
    $("blue-status").textContent = "Battle over";

    const winnerEl = $("summary-winner");
    const kind = winner === "Blue" ? "blue" : winner === "Red" ? "red" : "draw";
    winnerEl.className = `summary-winner ${kind}`;
    winnerEl.textContent = winner === "Draw" ? "DRAW" : `${winner.toUpperCase()} AI WINS`;

    const blocked = rounds.filter((r) => r.blocked).length;
    const bypassed = rounds.length - blocked;
    $("sum-red-hp").textContent = `${last.red_hp} HP`;
    $("sum-blue-hp").textContent = `${last.blue_hp} HP`;
    $("sum-rounds").textContent = String(rounds.length);
    $("sum-blocked").textContent = String(blocked);
    $("sum-bypassed").textContent = String(bypassed);
    $("sum-red-lost").textContent = `${TOTAL_HP - last.red_hp}`;
    $("sum-blue-lost").textContent = `${TOTAL_HP - last.blue_hp}`;
    $("summary").hidden = false;
    $("zone").classList.toggle("victory", !REDUCED_MOTION);

    const log = $("log");
    log.appendChild(el("p", "log-empty", `Match complete. ${winner === "Draw" ? "Draw." : winner + " AI wins."}`));
    log.scrollTop = log.scrollHeight;
  }

  // ---------- start, pause, rematch ----------
  function resetUi() {
    $("log").replaceChildren($("log-empty"));
    $("log-empty").hidden = false;
    $("log-empty").textContent = "Starting battle…";
    $("log-count").textContent = "0 events";
    setHp("red", TOTAL_HP);
    setHp("blue", TOTAL_HP);
    updateStats([], -1);
    $("red-status").textContent = "Standing by";
    $("blue-status").textContent = "Standing by";
    $("round-card").hidden = false;
    setRoundIndicator(0);
    buildTracker();
    setRoundCard({
      round: undefined,
      stateText: "LOADING",
      attackName: "Preparing the battle",
      prompt: "",
      defense: "—",
      outcome: "—",
      outcomeClass: "",
      damage: "—",
      message: "",
    });
    $("rc-round").textContent = "ROUND 00 / 10";
    $("summary").hidden = true;
    $("zone").classList.remove("victory");
    $("zone-error").hidden = true;
    resetLane();
  }

  function showError(message) {
    const box = $("zone-error");
    box.textContent = message;
    box.hidden = false;
    $("round-card").hidden = false;
    setRoundCard({ stateText: "ERROR", attackName: "Battle could not start", prompt: "", defense: "—", outcome: "—", outcomeClass: "", damage: "—", message: "" });
  }

  async function startBattle() {
    if (state.phase === "loading" || state.phase === "running" || state.phase === "paused") return;
    cancelRun();
    const run = state.runId;
    resetUi();
    setPhase("loading");

    let data;
    try {
      const res = await fetch(`/api/battle?rounds=${TOTAL_ROUNDS}`, { method: "POST" });
      if (!res.ok) {
        let detail = `Server returned HTTP ${res.status}.`;
        try {
          const body = await res.json();
          if (body && body.detail) detail = body.detail;
        } catch (ignored) { /* keep default message */ }
        throw new Error(detail);
      }
      data = await res.json();
    } catch (err) {
      if (run !== state.runId) return;
      const message = err && err.message && err.message !== "Failed to fetch"
        ? err.message
        : "Could not reach the battle server. Start it, then press START BATTLE again.";
      showError(message);
      setPhase("error");
      return;
    }
    if (run !== state.runId) return;

    state.data = data;
    setPhase("running");
    $("log-empty").textContent = "No events yet.";
    $("log-empty").hidden = true;
    const defense = data.mode === "azure" ? "Azure AI Foundry guardrails" : "simulated Azure guardrails";
    $("log").appendChild(el("p", "log-empty", `Battle started. Blue AI defends with ${defense}.`));

    try {
      await playBattle(run);
    } catch (err) {
      if (err !== CANCEL) {
        showError("Something went wrong while playing the battle.");
        setPhase("error");
      }
    }
  }

  function togglePause() {
    if (state.phase === "running") {
      setPaused(true);
      setPhase("paused");
    } else if (state.phase === "paused") {
      setPaused(false);
      setPhase("running");
    }
  }

  function onPrimaryClick() {
    if (state.phase === "running" || state.phase === "paused") {
      togglePause();
    } else {
      startBattle(); // ready, error, or complete (rematch)
    }
  }

  // ---------- report ----------
  function buildReport() {
    const body = $("report-body");
    body.replaceChildren();
    const data = state.data;
    if (!data) return;
    const rounds = data.rounds;
    const last = rounds[rounds.length - 1];
    const blocked = rounds.filter((r) => r.blocked).length;
    const bypassed = rounds.length - blocked;
    const winnerLabel = data.winner === "Draw" ? "Draw" : `${data.winner} AI wins`;

    // Outcome
    const outcome = el("section", "rep-outcome");
    outcome.appendChild(el("p", "label", "Match outcome"));
    outcome.appendChild(el("h3", null, winnerLabel));
    outcome.appendChild(el("p", "role", `Final health: Red AI ${last.red_hp} HP · Blue AI ${last.blue_hp} HP`));
    body.appendChild(outcome);

    // KPIs
    const kpis = el("div", "rep-kpis");
    [
      ["Total rounds", rounds.length],
      ["Blocked", blocked],
      ["Bypassed", bypassed],
      ["Red HP lost", TOTAL_HP - last.red_hp],
    ].forEach(([label, value]) => {
      const box = el("div");
      box.appendChild(el("b", null, String(value)));
      box.appendChild(el("span", null, label));
      kpis.appendChild(box);
    });
    body.appendChild(kpis);

    // Attack categories
    const categories = {};
    rounds.forEach((r) => {
      const key = r.attack.category;
      categories[key] = categories[key] || { total: 0, blocked: 0, bypassed: 0 };
      categories[key].total += 1;
      categories[key][r.blocked ? "blocked" : "bypassed"] += 1;
    });
    body.appendChild(section("Attack categories", Object.entries(categories).map(([key, c]) => {
      const row = el("div", "bar-row");
      row.appendChild(el("span", null, CATEGORY_LABELS[key] || key));
      const track = el("div", "bar-track");
      track.setAttribute("aria-hidden", "true");
      track.appendChild(barSegment("bar-blocked", c.blocked, c.total));
      track.appendChild(barSegment("bar-bypassed", c.bypassed, c.total));
      row.appendChild(track);
      row.appendChild(el("span", "bar-count", `${c.blocked} blocked · ${c.bypassed} bypassed`));
      return row;
    })));

    // Defense layers
    const layers = {};
    rounds.filter((r) => r.blocked).forEach((r) => {
      layers[r.layer_label] = (layers[r.layer_label] || 0) + 1;
    });
    const layerEntries = Object.entries(layers);
    const maxLayer = Math.max(1, ...layerEntries.map(([, n]) => n));
    body.appendChild(section("Defense mechanisms triggered", layerEntries.length
      ? layerEntries.map(([label, n]) => {
          const row = el("div", "bar-row");
          row.appendChild(el("span", null, label));
          const track = el("div", "bar-track");
          track.setAttribute("aria-hidden", "true");
          track.appendChild(barSegment("bar-blocked", n, maxLayer));
          row.appendChild(track);
          row.appendChild(el("span", "bar-count", String(n)));
          return row;
        })
      : [el("p", "role", "No defense layer triggered this match.")]));

    // Successful bypasses
    const breaches = rounds.filter((r) => !r.blocked);
    body.appendChild(section("Successful bypasses", breaches.length
      ? [listOf(breaches.map((r) => `Round ${r.round}: ${r.attack.name} (${CATEGORY_LABELS[r.attack.category] || r.attack.category}), Blue AI took ${blueLossFor(rounds, r)} damage`))]
      : [el("p", "role", "No attacks got through.")]));

    // Round-by-round table
    const wrap = el("div", "table-wrap");
    const table = el("table", "rep-table");
    const thead = el("thead");
    const headRow = el("tr");
    ["Round", "Attack", "Defense", "Outcome", "Damage"].forEach((h) => headRow.appendChild(el("th", null, h)));
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = el("tbody");
    rounds.forEach((r, i) => {
      const prev = i === 0 ? { red_hp: TOTAL_HP, blue_hp: TOTAL_HP } : rounds[i - 1];
      const tr = el("tr");
      tr.appendChild(el("td", "num", String(r.round).padStart(2, "0")));
      tr.appendChild(el("td", null, r.attack.name));
      tr.appendChild(el("td", null, r.layer_label || "No layer triggered"));
      const tdOutcome = el("td");
      tdOutcome.appendChild(el("span", `tag ${r.blocked ? "blocked" : "bypassed"}`, r.blocked ? "BLOCKED" : "BYPASSED"));
      tr.appendChild(tdOutcome);
      tr.appendChild(el("td", "num", r.blocked
        ? `Red ${minus}${prev.red_hp - r.red_hp}`
        : `Blue ${minus}${prev.blue_hp - r.blue_hp}`));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    body.appendChild(section("Round by round", [wrap]));

    if (data.report && data.report.alerts_are_simulated !== undefined) {
      const note = data.report.alerts_are_simulated
        ? `Defender alerts (simulated in demo mode): ${data.report.alerts.length}`
        : `Defender alerts from Azure: ${data.report.alerts.length}`;
      body.appendChild(el("p", "role", note));
    }
  }

  function blueLossFor(rounds, r) {
    const i = rounds.indexOf(r);
    const prev = i === 0 ? TOTAL_HP : rounds[i - 1].blue_hp;
    return prev - r.blue_hp;
  }

  function section(title, children) {
    const sec = el("section", "rep-section");
    sec.appendChild(el("h4", null, title));
    children.forEach((c) => sec.appendChild(c));
    return sec;
  }

  function listOf(items) {
    const ul = el("ul", "rep-list");
    items.forEach((text) => ul.appendChild(el("li", null, text)));
    return ul;
  }

  function barSegment(cls, value, total) {
    const seg = el("div", cls);
    seg.style.width = total > 0 ? `${(value / total) * 100}%` : "0%";
    return seg;
  }

  // ---------- modals ----------
  let lastFocus = null;

  function openModal(id) {
    lastFocus = document.activeElement;
    const modal = $(id);
    modal.hidden = false;
    const close = modal.querySelector("[data-close]");
    if (close) close.focus();
  }

  function closeModal(modal) {
    modal.hidden = true;
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  function openReport() {
    if (!state.data) return;
    buildReport();
    openModal("report-modal");
  }

  // ---------- wiring ----------
  function bind() {
    $("primary-btn").addEventListener("click", onPrimaryClick);
    $("report-btn").addEventListener("click", openReport);
    $("sum-report").addEventListener("click", openReport);
    $("log-filter").addEventListener("change", applyFilter);
    $("sum-rematch").addEventListener("click", startBattle);
    $("info-btn").addEventListener("click", () => openModal("info-modal"));

    document.querySelectorAll(".backdrop").forEach((backdrop) => {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeModal(backdrop);
      });
    });
    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => closeModal(btn.closest(".backdrop")));
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      document.querySelectorAll(".backdrop").forEach((b) => {
        if (!b.hidden) closeModal(b);
      });
    });
  }

  function loadMode() {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => {
        $("mode-badge").textContent = d.mode === "azure"
          ? "Live · Azure AI Content Safety"
          : "Demo mode · simulated Azure guardrails";
      })
      .catch(() => { $("mode-badge").textContent = "Server offline"; });
  }

  function init() {
    bind();
    buildTracker();
    resetUi();
    setPhase("ready");
    setHp("red", TOTAL_HP);
    setHp("blue", TOTAL_HP);
    $("round-card").hidden = false;
    setRoundCard({ stateText: "PRESS START BATTLE", attackName: "Blue AI is ready to defend", prompt: "", defense: "—", outcome: "—", outcomeClass: "", damage: "—", message: "" });
    $("rc-round").textContent = "READY";
    $("log-empty").textContent = "No battle yet. Press START BATTLE.";
    loadMode();
  }

  init();
})();
