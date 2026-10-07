(() => {
  "use strict";

  if (window.__IG_BATCH_UNLIKER_V12_2__) return;
  window.__IG_BATCH_UNLIKER_V12_2__ = true;

  const LIKES_PATH =
    "/your_activity/interactions/likes";

  const STORE =
    "instagramBatchUnlikerStateV12_2";

  const PENDING =
    "pendingStart";

  const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  const selectionPause = () =>
    sleep(state.selectionDelayMs);

  const state = {
    connected: true,
    likesPage: false,
    running: false,
    paused: false,
    stopping: false,
    runId: 0,
    stallRefreshes: 0,
    processed: 0,
    target: 100,
    batch: 0,
    batchSize: 20,
    delayMs: 10000,
    selectionDelayMs: 100,
    mode: "loop",
    status: "Connected."
  };

  const STALL_TIMEOUT_MS = 30000;
  const STALL_REFRESH_COOLDOWN_MS = 45000;
  let lastRefreshAt = 0;
  let activeRunId = 0;

  function isRunActive(runId) {
    return state.running && !state.stopping && state.runId === runId;
  }

  function requestStopCurrentWork() {
    // Invalidate every in-flight async operation immediately. A later Start
    // gets a new runId and can never be mistaken for this stopped run.
    state.stopping = true;
    state.paused = false;
    state.runId++;
    activeRunId = 0;
  }

  async function exitSelectionMode() {
    // Stop is a hard reset, not a pause. If Instagram is currently in
    // selection mode, leave that mode so the next Start can find "Select"
    // normally instead of getting stuck waiting for a button that no longer
    // exists.
    const cancel = buttonByText(["cancel"]);
    if (!cancel) return;

    try {
      clickLikeUser(cancel);
      await sleep(600);
    } catch {
      // The DOM can disappear during navigation; the next Start will retry
      // from the fresh page state.
    }
  }

  async function refreshForStall(reason) {
    const now = Date.now();
    if (now - lastRefreshAt < STALL_REFRESH_COOLDOWN_MS) return false;
    if (state.stallRefreshes >= 3) return false;
    lastRefreshAt = now;
    state.stallRefreshes++;
    state.status = `${reason} Refreshing Instagram…`;
    await save();
    await chrome.storage.local.set({
      [PENDING]: {
        target: state.target,
        batchSize: state.batchSize,
        delaySeconds: state.delayMs / 1000,
        selectionDelayMs: state.selectionDelayMs,
        mode: state.mode,
        processed: state.processed,
        stallRefreshes: state.stallRefreshes,
        resume: true
      }
    });
    try {
      await chrome.runtime.sendMessage({
        action: "RELOAD_TAB"
      });
      return true;
    } catch {
      return false;
    }
  }

  function isLikesPage() {
    return location.pathname
      .replace(/\/+$/, "") === LIKES_PATH;
  }

  function normalize(v) {
    return String(v || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 &&
      r.height > 0 &&
      cs.display !== "none" &&
      cs.visibility !== "hidden";
  }

  function mainText() {
    return normalize(
      document.querySelector("main")?.innerText || ""
    );
  }

  function exactTextElements(text, root = document) {
    const wanted = normalize(text);
    return [...root.querySelectorAll("*")].filter(el => {
      if (!visible(el)) return false;
      return normalize(el.textContent) === wanted;
    });
  }

  function clickableAncestor(el) {
    let node = el;

    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      if (!visible(node)) continue;

      const role = normalize(node.getAttribute("role"));
      const tab = node.getAttribute("tabindex");
      const tag = node.tagName;

      if (
        tag === "BUTTON" ||
        tag === "A" ||
        role === "button" ||
        tab !== null ||
        node.onclick
      ) {
        return node;
      }
    }

    // If Instagram's Bloks wrapper doesn't expose button semantics,
    // return the text element itself. Its click bubbles through the
    // React/Bloks hierarchy.
    return el;
  }

  function clickLikeUser(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;

    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        button: 0
      }));
    }

    el.click();
  }

  function buttonByText(texts, root = document) {
    for (const text of texts) {
      const exact = exactTextElements(text, root);

      if (exact.length) {
        // Prefer the smallest visible exact-text element.
        exact.sort((a, b) =>
          a.getBoundingClientRect().width *
          a.getBoundingClientRect().height -
          b.getBoundingClientRect().width *
          b.getBoundingClientRect().height
        );

        return clickableAncestor(exact[0]);
      }
    }

    return null;
  }

  function unlikeButton(root = document) {
    const exact = exactTextElements("Unlike", root);

    if (!exact.length) return null;

    exact.sort((a, b) =>
      a.getBoundingClientRect().width *
      a.getBoundingClientRect().height -
      b.getBoundingClientRect().width *
      b.getBoundingClientRect().height
    );

    return clickableAncestor(exact[0]);
  }

  function selectedCount() {
    const text = mainText();
    const m = text.match(/\b(\d+)\s+selected\b/i);
    return m ? Number(m[1]) : 0;
  }

  function findSelectControl() {
    // Before selection Instagram shows "Select".
    // After selection it becomes "Cancel". Therefore "Select" is
    // deliberately checked explicitly.
    return buttonByText(["select"]);
  }

  function postKey(img) {
    // Prefer the actual post URL when available. It survives React re-renders
    // and is much safer than using a DOM node as identity.
    const a = img.closest("a[href]");
    if (a) {
      const href = a.href || a.getAttribute("href") || "";
      if (/\/(p|reel|tv)\//.test(href)) return href;
    }

    // Fallback to Instagram's image URL.
    return img.currentSrc ||
      img.src ||
      (img.alt || "") + "|" +
      Math.round(img.getBoundingClientRect().width);
  }

  function findGridImages() {
    const imgs = [
      ...document.querySelectorAll("main img")
    ];

    const candidates = [];
    const seen = new Set();

    for (const img of imgs) {
      if (!visible(img)) continue;

      const r = img.getBoundingClientRect();

      // Instagram's post thumbnails are large, roughly square images.
      if (r.width < 120 || r.height < 120) continue;
      if (r.width > 700 || r.height > 700) continue;

      const ratio = r.width / r.height;
      if (ratio < 0.70 || ratio > 1.45) continue;

      // Exclude left navigation/sidebar.
      if (r.left < window.innerWidth * 0.28) continue;

      // Exclude tiny/odd UI imagery.
      if (r.top > window.innerHeight + 100 ||
          r.bottom < -100) continue;

      const key = postKey(img);
      if (seen.has(key)) continue;

      seen.add(key);

      candidates.push({
        img,
        key,
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height
      });
    }

    candidates.sort((a, b) => {
      if (Math.abs(a.top - b.top) > 30) {
        return a.top - b.top;
      }
      return a.left - b.left;
    });

    return candidates;
  }

  function postTile(img) {
    // Prefer the post's anchor/container, but don't climb into the entire
    // page. This is used only for fallback clicking.
    const a = img.closest("a[href]");
    if (a) return a;

    let node = img;
    for (let i = 0; i < 5 && node.parentElement; i++) {
      node = node.parentElement;
      const r = node.getBoundingClientRect();
      if (
        r.width >= 120 &&
        r.height >= 120 &&
        r.width <= 700 &&
        r.height <= 700
      ) {
        return node;
      }
    }

    return img;
  }

  function viewportScrollDown() {
    const before = window.scrollY;

    // Use the page viewport deliberately. The screenshot shows the Likes
    // grid is part of the document, not a dedicated scroll pane.
    window.scrollBy({
      top: Math.max(350, Math.floor(window.innerHeight * 0.72)),
      left: 0,
      behavior: "auto"
    });

    return before;
  }

  function scrollerFor() {
    return document.scrollingElement ||
      document.documentElement;
  }

  async function waitFor(fn, timeout = 15000, runId = state.runId) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (state.stopping || state.runId !== runId) return null;

      const value = fn();
      if (value) return value;

      await sleep(400);
    }

    return null;
  }

  async function save() {
    await chrome.storage.local.set({
      [STORE]: {
        ...state,
        updatedAt: Date.now()
      }
    });
  }

  async function clearState() {
    await chrome.storage.local.remove([
      STORE,
      PENDING
    ]);
  }

  async function clickCenter(item) {
    const el = item.img;
    el.scrollIntoView({
      block: "nearest",
      inline: "nearest"
    });

    await sleep(100);

    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;

    const target =
      document.elementFromPoint(x, y) || el;

    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y
      })
    );

    await sleep(150);
  }

  async function clickPostAndVerify(item, expected) {
    if (state.stopping) return false;

    const img = item.img;

    // Re-read the current DOM position immediately before every click.
    // React can replace nodes after selection.
    img.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "auto"
    });

    await sleep(250);
    if (state.stopping) return false;

    const before = selectedCount();

    // First click the actual post image. In Instagram selection mode this
    // bubbles to the post's selection handler.
    clickLikeUser(img);

    await selectionPause();
    if (state.stopping) return false;

    let after = selectedCount();

    if (after >= expected || after > before) {
      return true;
    }

    // Fallback: click the post's containing tile.
    const tile = postTile(img);
    if (tile && tile !== img) {
      clickLikeUser(tile);
      await selectionPause();
      if (state.stopping) return false;
      after = selectedCount();

      if (after >= expected || after > before) {
        return true;
      }
    }

    return false;
  }

  async function selectBatch(runId) {
    state.status = "Looking for Select…";
    await save();

    const select = await waitFor(findSelectControl, 30000, runId);
    if (!select || !isRunActive(runId)) {
      if (!state.stopping && state.runId === runId) {
        state.status = "Select control not found after 30s.";
        await save();
      }
      return 0;
    }

    state.status = "Select text found — activating…";
    await save();

    select.scrollIntoView({block: "center", behavior: "auto"});
    clickLikeUser(select);
    await sleep(900);

    let inSelectionMode = !!buttonByText(["cancel"]) || selectedCount() > 0;
    if (!inSelectionMode) {
      let parent = select.parentElement;
      for (let i = 0; i < 5 && parent; i++, parent = parent.parentElement) {
        if (!visible(parent)) continue;
        const role = normalize(parent.getAttribute("role"));
        if (parent.tagName === "BUTTON" || role === "button" || parent.getAttribute("tabindex") !== null) {
          clickLikeUser(parent);
          await sleep(700);
          break;
        }
      }
    }

    state.status = "Select mode active.";
    await save();

    const wanted = Math.min(state.batchSize, state.target - state.processed);
    let selectedThisBatch = 0;
    const selectedKeys = new Set();
    let lastKnownPostCount = 0;
    let lastProgressAt = Date.now();
    let lastScrollY = window.scrollY;
    let refreshCount = 0;

    window.scrollTo({top: 0, left: 0, behavior: "auto"});
    await sleep(700);

    while (selectedThisBatch < wanted && isRunActive(runId)) {
      if (state.paused) {
        state.status = "Paused.";
        await save();
        while (state.paused && isRunActive(runId)) await sleep(500);
        continue;
      }

      const items = findGridImages();
      const visibleItems = items.filter(item => {
        const r = item.img.getBoundingClientRect();
        return r.bottom > 80 && r.top < window.innerHeight - 20 &&
          r.right > 0 && r.left < window.innerWidth &&
          !selectedKeys.has(item.key);
      });

      if (items.length > lastKnownPostCount) {
        lastKnownPostCount = items.length;
        lastProgressAt = Date.now();
        state.stallRefreshes = 0;
      }

      if (visibleItems.length) {
        for (const item of visibleItems) {
          if (selectedThisBatch >= wanted || !isRunActive(runId)) break;
          if (!document.contains(item.img)) continue;

          state.status = `Selecting ${selectedThisBatch + 1}/${wanted}…`;
          await save();
          const expected = selectedCount() + 1;
          const ok = await clickPostAndVerify(item, expected);

          if (ok) {
            selectedThisBatch++;
            selectedKeys.add(item.key);
            lastProgressAt = Date.now();
            state.status = `Selected ${selectedThisBatch}/${wanted}.`;
            await save();
          } else {
            state.status = `Could not confirm selection ${selectedThisBatch + 1}/${wanted}; retrying…`;
            await save();
            await sleep(500);
            const retry = findGridImages().find(x =>
              !selectedKeys.has(x.key) && document.contains(x.img) &&
              Math.abs(x.img.getBoundingClientRect().top - item.top) < 100 &&
              Math.abs(x.img.getBoundingClientRect().left - item.left) < 150
            );
            if (retry && await clickPostAndVerify(retry, selectedCount() + 1)) {
              selectedThisBatch++;
              selectedKeys.add(retry.key);
              lastProgressAt = Date.now();
            }
          }
        }
      }

      if (selectedThisBatch >= wanted || !isRunActive(runId)) break;

      const beforeY = window.scrollY;
      viewportScrollDown();
      await sleep(900);
      const afterY = window.scrollY;
      await sleep(600);

      const afterItems = findGridImages();
      if (afterItems.length > lastKnownPostCount) {
        lastKnownPostCount = afterItems.length;
        lastProgressAt = Date.now();
        state.stallRefreshes = 0;
      }

      // Do NOT interpret a fixed scroll position as end-of-list. Instagram
      // can pause lazy loading while keeping the viewport at the same point.
      if (afterY !== beforeY || afterY !== lastScrollY) {
        lastScrollY = afterY;
      }

      if (Date.now() - lastProgressAt >= STALL_TIMEOUT_MS) {
        refreshCount++;
        if (state.stallRefreshes >= 3) {
          const cancel = buttonByText(["cancel"]);
          if (cancel) {
            clickLikeUser(cancel);
            await sleep(500);
          }
          state.status = "Instagram did not load more posts after 3 refresh attempts. Batch cancelled safely.";
          await save();
          return 0;
        }
        const refreshed = await refreshForStall(
          `No new posts for ${Math.floor(STALL_TIMEOUT_MS / 1000)}s.`
        );
        if (refreshed) {
          // The page reload clears selection UI, but the posts remain liked.
          // Restart selection for this same batch from the top.
          return await selectBatch(runId);
        }
        lastProgressAt = Date.now();
      }
    }

    if (selectedThisBatch > 0) {
      state.status = `${selectedThisBatch} selected.`;
      await save();
    }

    return selectedThisBatch;
  }

  async function clickUnlike(count, runId) {
    const button =
      await waitFor(
        () => unlikeButton(),
        10000,
        runId
      );

    if (!button) {
      state.status =
        "Unlike button not found.";
      await save();
      return false;
    }

    state.status =
      `${count} selected — clicking Unlike…`;

    await save();

    button.scrollIntoView({
      block: "center"
    });

    const selectedBeforeUnlike = selectedCount();

    clickLikeUser(button);

    await sleep(1000);

    // Some Instagram builds may show a confirmation dialog.
    const dialog =
      [...document.querySelectorAll(
        "[role='dialog'],[aria-modal='true']"
      )].find(d =>
        visible(d) &&
        normalize(d.innerText).includes("unlike")
      );

    if (dialog) {
      const confirm =
        unlikeButton(dialog) ||
        buttonByText(["unlike"], dialog);

      if (confirm) {
        clickLikeUser(confirm);
        await sleep(1000);
      }
    }

    await sleep(1200);

    // If Instagram still reports the same selected count, don't advance the
    // automation as though the batch was completed.
    const remainingSelected = selectedCount();

    if (
      selectedBeforeUnlike > 0 &&
      remainingSelected >= selectedBeforeUnlike
    ) {
      state.status =
        "Unlike could not be confirmed; stopped for safety.";
      await save();
      return false;
    }

    return true;
  }

  async function waitBetweenBatches(runId) {
    let left = state.delayMs;

    while (left > 0 && isRunActive(runId)) {
      if (state.paused) {
        state.status = "Paused.";
        await save();

        await sleep(500);
        continue;
      }

      state.status =
        `Waiting ${Math.ceil(left / 1000)}s…`;

      await save();

      const step = Math.min(500, left);
      await sleep(step);
      left -= step;
    }

    return !state.stopping;
  }

  async function run(runId = state.runId) {
    if (!isLikesPage() || state.stopping || state.runId !== runId) return;
    if (state.running && activeRunId !== runId) return;

    state.running = true;
    activeRunId = runId;
    await save();

    while (isRunActive(runId) && state.processed < state.target) {
      if (state.paused) {
        await sleep(500);
        continue;
      }

      state.batch++;
      const count = await selectBatch(runId);
      if (!isRunActive(runId)) return;

      if (!count) {
        state.running = false;
        state.status = "No posts were selected. Stopped for safety.";
        await save();
        return;
      }

      const success = await clickUnlike(count, runId);
      if (!isRunActive(runId)) return;

      if (!success) {
        state.running = false;
        await save();
        return;
      }

      state.processed += count;
      state.status = `Batch ${state.batch} complete · ${state.processed}/${state.target}`;
      await save();

      if (state.processed >= state.target) {
        state.running = false;
        state.status = `Target reached: ${state.processed}.`;
        await clearState();
        return;
      }

      if (state.mode === "once") {
        state.running = false;
        state.status = `One batch complete: ${state.processed}.`;
        await clearState();
        return;
      }

      if (!await waitBetweenBatches(runId)) return;
      if (!isRunActive(runId)) return;

      state.status = "Preparing next batch…";
      await save();
      await sleep(800);
    }

    if (state.runId === runId) {
      state.running = false;
      await save();
    }
  }

  function publicState() {
    return {
      connected: true,
      likesPage: isLikesPage(),
      running: state.running,
      paused: state.paused,
      processed: state.processed,
      target: state.target,
      batch: state.batch,
      batchSize: state.batchSize,
      selectionDelayMs: state.selectionDelayMs,
      mode: state.mode,
      status: state.status
    };
  }

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      if (message.action === "PING") {
        state.likesPage = isLikesPage();
        sendResponse(publicState());
        return true;
      }

      if (!isLikesPage()) {
        state.likesPage = false;
        sendResponse({
          ...publicState(),
          status: "Open the Instagram Likes page first."
        });
        return true;
      }

      state.likesPage = true;

      if (message.action === "START") {
        // START has three distinct meanings:
        //  1. Paused -> resume the EXISTING async run in-place. This is
        //     critical because selectBatch() keeps its selection cursor and
        //     selectedKeys in local variables while paused. Restarting run()
        //     here would throw that cursor away and begin looking for Select
        //     again.
        //  2. Running -> apply the latest settings without spawning another
        //     runner. The current loop keeps its position.
        //  3. Stopped/idle -> create a fresh run.
        const wasPaused = state.paused && state.running;
        const wasRunning = state.running && !state.paused;

        state.target =
          Math.max(1, Number(message.target) || 1);

        state.batchSize =
          Math.max(
            1,
            Math.min(
              99,
              Number(message.batchSize) || 20
            )
          );

        state.selectionDelayMs =
          Math.max(
            10,
            Math.min(
              300,
              Number(message.selectionDelayMs) || 100
            )
          );

        state.delayMs =
          Math.max(
            10000,
            Math.min(
              300000,
              (Number(message.delaySeconds) || 10) * 1000
            )
          );

        state.mode =
          message.mode === "once"
            ? "once"
            : "loop";

        if (wasPaused) {
          // DO NOT increment runId and DO NOT call run() again. The existing
          // selectBatch()/waitBetweenBatches() coroutine is still alive and
          // will continue from exactly where it paused.
          state.paused = false;
          state.stopping = false;
          state.status = "Resuming…";
          save();
        } else if (wasRunning) {
          // Settings are live-applied, but never start a second runner.
          state.status = "Settings updated. Continuing…";
          save();
        } else {
          // Fresh run after Stop / idle state.
          state.runId++;
          const runId = state.runId;
          state.stopping = false;
          state.paused = false;
          state.running = false;
          state.batch = 0;
          state.stallRefreshes = 0;
          state.status = "Starting…";

          save().then(() => run(runId));
        }
      }

      if (message.action === "PAUSE") {
        if (state.running) {
          state.paused = !state.paused;
          state.status = state.paused ? "Paused." : "Resuming…";
          save();
        }
      }

      if (message.action === "STOP") {
        requestStopCurrentWork();
        state.running = false;
        state.paused = false;
        state.processed = 0;
        state.batch = 0;
        state.stallRefreshes = 0;
        state.status = "Stopping…";

        (async () => {
          await exitSelectionMode();
          state.stopping = false;
          state.status = "Stopped. Ready to start again.";
          await clearState();
          await save();
          sendResponse(publicState());
        })();
        return true;
      }

      sendResponse(publicState());
      return true;
    }
  );

  setInterval(() => {
    if (state.running) {
      save();
    }
  }, 2000);

  async function startup() {
    state.likesPage = isLikesPage();

    if (!state.likesPage) return;

    // The popup/background writes pendingStart BEFORE navigation in v7.
    // Retry briefly anyway because MV3/content-script startup ordering can
    // vary on a freshly navigated Instagram document.
    for (let attempt = 0; attempt < 20; attempt++) {
      const pending =
        await chrome.storage.local.get(PENDING);

      if (pending[PENDING]) {
        const p = pending[PENDING];

        await chrome.storage.local.remove(PENDING);

        state.target = Math.max(
          1,
          Number(p.target) || 1
        );

        state.batchSize = Math.max(
          1,
          Math.min(99, Number(p.batchSize) || 20)
        );

        state.selectionDelayMs = Math.max(
          10,
          Math.min(300, Number(p.selectionDelayMs) || 100)
        );

        state.delayMs = Math.max(
          10000,
          Math.min(
            300000,
            (Number(p.delaySeconds) || 10) * 1000
          )
        );

        state.mode =
          p.mode === "once" ? "once" : "loop";

        const resumedProcessed = p.resume
          ? Math.max(0, Number(p.processed) || 0)
          : 0;
        state.processed = resumedProcessed;
        state.stallRefreshes = Math.max(0, Number(p.stallRefreshes) || 0);
        state.batch = 0;
        state.paused = false;
        state.stopping = false;
        state.runId++;
        const runId = state.runId;
        state.status =
          "Likes page loaded. Starting…";

        await save();

        // Give Instagram's React grid and Select control time to render.
        await sleep(2500);

        run(runId);
        return;
      }

      await sleep(500);
    }
  }

  console.info(
    "[Instagram Batch Unliker v12.2] Connected.",
    location.href
  );

  startup();
})();
