const LIKES_URL = "https://www.instagram.com/your_activity/interactions/likes/";

async function activeTab() {
  const tabs = await chrome.tabs.query({active: true, currentWindow: true});
  return tabs[0];
}

function isInstagram(url) {
  try {
    const u = new URL(url || "");
    return u.protocol === "https:" && u.hostname === "www.instagram.com";
  } catch {
    return false;
  }
}

function isLikes(url) {
  try {
    const u = new URL(url || "");
    return u.hostname === "www.instagram.com" &&
      u.pathname.replace(/\/+$/, "") ===
      "/your_activity/interactions/likes";
  } catch {
    return false;
  }
}

async function injectAndPing(tabId) {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, {action: "PING"});
    if (ping?.connected) return ping;
  } catch {}

  try {
    await chrome.scripting.executeScript({
      target: {tabId},
      files: ["content.js"]
    });
    await new Promise(r => setTimeout(r, 200));
    return await chrome.tabs.sendMessage(tabId, {action: "PING"});
  } catch (e) {
    return {
      connected: false,
      error: e?.message || String(e)
    };
  }
}

async function navigateToLikes(tab) {
  if (!tab?.id) throw new Error("No active tab.");

  if (!isInstagram(tab.url)) {
    await chrome.tabs.update(tab.id, {url: LIKES_URL});
  } else if (!isLikes(tab.url)) {
    await chrome.tabs.update(tab.id, {url: LIKES_URL});
  }

  return tab.id;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.action === "OPEN_LIKES") {
        const current = await activeTab();

        if (!current?.id) {
          sendResponse({ok: false, error: "No active tab."});
          return;
        }

        // IMPORTANT: save the pending run BEFORE navigation. Otherwise
        // the new Instagram document can initialize before the popup gets
        // a chance to save the command, which was the v6 race condition.
        if (message.pendingStart) {
          await chrome.storage.local.set({
            pendingStart: message.pendingStart
          });
        }

        const tabId = await navigateToLikes(current);

        sendResponse({
          ok: true,
          tabId,
          likesUrl: LIKES_URL
        });
        return;
      }

      if (message.action === "GET_CONNECTION") {
        const tab = await activeTab();

        if (!tab?.id) {
          sendResponse({ok: false, error: "No active tab."});
          return;
        }

        if (!isInstagram(tab.url)) {
          sendResponse({
            ok: false,
            state: {
              connected: false,
              likesPage: false,
              status: "Open Instagram first."
            }
          });
          return;
        }

        const state = await injectAndPing(tab.id);

        sendResponse({
          ok: !!state?.connected,
          tabId: tab.id,
          state
        });
        return;
      }

      if (message.action === "RELOAD_TAB") {
        const tab = await activeTab();
        if (!tab?.id || !isLikes(tab.url)) {
          sendResponse({ok: false, error: "Instagram Likes page is not active."});
          return;
        }
        await chrome.tabs.reload(tab.id, {bypassCache: false});
        sendResponse({ok: true, tabId: tab.id});
        return;
      }

      if (message.action === "TO_TAB") {
        const tab = await activeTab();

        if (!tab?.id || !isInstagram(tab.url)) {
          sendResponse({
            ok: false,
            error: "Instagram is not the active tab."
          });
          return;
        }

        const state = await injectAndPing(tab.id);

        if (!state?.connected) {
          sendResponse({
            ok: false,
            error: state?.error || "Content script did not respond."
          });
          return;
        }

        const response = await chrome.tabs.sendMessage(
          tab.id,
          message.payload
        );

        sendResponse({
          ok: true,
          state: response
        });
        return;
      }

      sendResponse({ok: false, error: "Unknown command."});
    } catch (e) {
      sendResponse({
        ok: false,
        error: e?.message || String(e)
      });
    }
  })();

  return true;
});
