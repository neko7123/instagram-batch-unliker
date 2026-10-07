const $ = id => document.getElementById(id);

let refreshTimer;

function getMode() {
  return document.querySelector(
    'input[name="mode"]:checked'
  )?.value || "loop";
}

function setConnection(text, type = "") {
  const card = $("connection").closest(".connection-card");
  $("connection").textContent = text;
  card.className = `connection-card ${type}`.trim();
}

function updateProgress(processed, target) {
  const safeTarget = Math.max(1, Number(target) || 1);
  const safeProcessed = Math.max(0, Number(processed) || 0);
  const percent = Math.min(100, (safeProcessed / safeTarget) * 100);

  $("progressText").textContent = `${safeProcessed} / ${safeTarget}`;
  $("progressBar").style.width = `${percent}%`;
}

function render(state) {
  if (!state) return;

  $("status").textContent = state.status || "Ready";
  updateProgress(state.processed, state.target ?? $("target").value);

  $("start").textContent = state.paused ? "Resume" : "Start";
  $("start").disabled = Boolean(state.running && !state.paused);
  $("pause").disabled = !state.running || state.paused;
  $("stop").disabled = !state.running && !state.paused;

  if (state.connected) {
    setConnection(
      state.likesPage
        ? "Connected · Likes page detected"
        : "Connected · Open the Likes page to start",
      "ok"
    );
  }

  if (typeof state.selectionDelayMs === "number" &&
      document.activeElement !== $("selectionDelayMs")) {
    $("selectionDelayMs").value = state.selectionDelayMs;
    updateSpeedLabel();
  }
}

async function send(action, payload = {}) {
  return chrome.runtime.sendMessage({action, payload});
}

async function openLikes() {
  $("status").textContent = "Opening Instagram Likes page…";

  const result = await send("OPEN_LIKES");

  if (!result?.ok) {
    setConnection(
      result?.error || "Could not open Likes page.",
      "error"
    );
    return;
  }

  setConnection("Opening Likes page…");
  $("status").textContent = "Waiting for Instagram to load…";
}

async function connect() {
  try {
    const result = await send("GET_CONNECTION");

    if (!result?.ok) {
      setConnection(
        result?.error ||
          result?.state?.status ||
          "Could not connect to Instagram.",
        "error"
      );
      return;
    }

    render(result.state);
  } catch {
    setConnection("Waiting for Instagram…");
  }
}

async function start() {
  const target = Math.max(
    1,
    Number($("target").value) || 1
  );

  const batchSize = Math.max(
    1,
    Math.min(99, Number($("batchSize").value) || 20)
  );

  const delaySeconds = Math.max(
    10,
    Math.min(300, Number($("delaySeconds").value) || 10)
  );

  const selectionDelayMs = Math.max(
    10,
    Math.min(300, Number($("selectionDelayMs").value) || 100)
  );

  const mode = getMode();
  const settings = {
    target,
    batchSize,
    delaySeconds,
    selectionDelayMs,
    mode
  };

  await chrome.storage.local.set(settings);

  const current = await send("GET_CONNECTION");
  const isPausedRun = Boolean(current?.ok && current.state?.running && current.state?.paused);

  if (!isPausedRun) {
    updateProgress(0, target);
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  let path = "";
  try {
    path = new URL(tab?.url || "").pathname.replace(/\/+$/, "");
  } catch {
    // The service worker will provide the final error if the tab is not usable.
  }

  if (path !== "/your_activity/interactions/likes") {
    $("status").textContent = "Opening Likes page and preparing run…";

    const result = await send("OPEN_LIKES", {
      pendingStart: settings
    });

    if (!result?.ok) {
      setConnection(
        result?.error || "Could not open Likes page.",
        "error"
      );
      return;
    }

    setConnection("Likes page opening…");
    $("status").textContent = "Waiting for Instagram to load…";
    return;
  }

  const result = await send("TO_TAB", {
    action: "START",
    ...settings
  });

  if (result?.ok) {
    render(result.state);
  } else {
    setConnection(
      result?.error || "Start failed.",
      "error"
    );
  }
}

async function pause() {
  const result = await send("TO_TAB", {action: "PAUSE"});
  if (result?.ok) render(result.state);
  else await connect();
}

async function stop() {
  const result = await send("TO_TAB", {action: "STOP"});
  if (result?.ok) render(result.state);
  else await connect();
}

function updateSpeedLabel() {
  $("speedValue").textContent = `${$("selectionDelayMs").value} ms`;
}


$("openLikes").addEventListener("click", openLikes);
$("start").addEventListener("click", start);
$("pause").addEventListener("click", pause);
$("stop").addEventListener("click", stop);
$("selectionDelayMs").addEventListener("input", updateSpeedLabel);

window.addEventListener("unload", () => {
  clearInterval(refreshTimer);
});

document.addEventListener("DOMContentLoaded", async () => {
  const saved = await chrome.storage.local.get({
    target: 100,
    batchSize: 20,
    delaySeconds: 10,
    selectionDelayMs: 100,
    mode: "loop"
  });

  $("target").value = saved.target;
  $("batchSize").value = Math.min(99, saved.batchSize);
  $("delaySeconds").value = saved.delaySeconds;
  $("selectionDelayMs").value = saved.selectionDelayMs;
  updateSpeedLabel();
  updateProgress(0, saved.target);

  const radio = document.querySelector(
    `input[name="mode"][value="${saved.mode}"]`
  );
  if (radio) radio.checked = true;

  await connect();

  // The popup is short-lived, so a lightweight polling loop keeps the live
  // progress indicator current while it is open without background polling.
  refreshTimer = setInterval(connect, 1200);
});
