// ---------- DEPENDENCIES ----------
import { Client, GatewayIntentBits } from "discord.js";
import fetch from "node-fetch";

// ---------- CONFIG ----------
const TOKEN = "MTQyNzczNDk1NDAwMzE0MDY4MA.Gzv8vm.FlRRYLdXjDCG39PKctx8ZrE4auus0PN4jjusS0"; // replace with your bot token
const TRACKED_USER_IDS = ["909635"]; // Roblox numeric user IDs as strings
const TARGET_PLACE_ID = "16732694052"; // place ID to detect
const CHECK_INTERVAL_MS = 30_000; // check every 30 seconds
const DISCORD_CHANNEL_ID = "1389151215278886952"; // the channel to post alerts
// -----------------------------

// internal cache to avoid duplicate notifications
const lastPresences = new Map(); // userId -> { userPresenceType, placeId, universeId, lastNotifiedTag }

// ---------- FUNCTIONS ----------
async function fetchPresenceFor(userIds) {
  const res = await fetch("https://presence.roblox.com/v1/presence/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userIds: userIds.map(id => parseInt(id, 10)) }),
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after") || null;
    const err = new Error("Rate limited");
    err.retryAfter = retryAfter;
    throw err;
  }
  if (!res.ok) throw new Error(`Presence request failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.userPresences || [];
}

function isTargetPlace(p) {
  const placeId = p.placeId ? String(p.placeId) : null;
  const rootPlaceId = p.rootPlaceId ? String(p.rootPlaceId) : null;
  const universeId = p.universeId ? String(p.universeId) : null;

  return (placeId && placeId === TARGET_PLACE_ID)
      || (rootPlaceId && rootPlaceId === TARGET_PLACE_ID)
      || (universeId && universeId === TARGET_PLACE_ID);
}

async function checkTrackedUsers(client) {
  try {
    const presList = await fetchPresenceFor(TRACKED_USER_IDS);
    for (const p of presList) {
      const userId = String(p.userId);
      const prev = lastPresences.get(userId) || null;

      const nowType = p.userPresenceType;
      const nowPlaceId = p.placeId ? String(p.placeId) : (p.rootPlaceId ? String(p.rootPlaceId) : null);
      const nowUniverseId = p.universeId ? String(p.universeId) : null;
      const nowLocation = p.lastLocation ?? null;
      const nowTag = `${nowType}|${nowPlaceId || ""}|${nowUniverseId || ""}`;

      const wasInTarget = prev ? (
        (prev.placeId && prev.placeId === TARGET_PLACE_ID) ||
        (prev.universeId && prev.universeId === TARGET_PLACE_ID)
      ) : false;

      const nowInTarget = isTargetPlace(p);
      let shouldNotify = false;
      let reason = "";

      if (!wasInTarget && nowInTarget) {
        shouldNotify = true;
        reason = "joined";
      }

      lastPresences.set(userId, {
        userPresenceType: nowType,
        placeId: nowPlaceId,
        universeId: nowUniverseId,
        lastLocation: nowLocation,
        lastNotifiedTag: nowTag,
      });

      if (shouldNotify) {
        const channel = await client.channels.fetch(DISCORD_CHANNEL_ID).catch(() => null);
        if (!channel || !channel.send) {
          console.log("Notification channel not found or cannot send messages.");
          continue;
        }

        const profileUrl = `https://www.roblox.com/users/${userId}/profile`;
        const placeUrl = nowPlaceId ? `https://www.roblox.com/games/${nowPlaceId}` : null;

        let msg = `🔔 Roblox user **${userId}** ${reason} the target place`;
        if (nowLocation) msg += `: **${nowLocation}**`;
        if (placeUrl) msg += `\n🔗 ${placeUrl}`;
        msg += `\n👤 ${profileUrl}`;

        channel.send(msg).catch(console.error);
      }
    }
  } catch (err) {
    console.error("Error checking presences:", err?.message ?? err);
    if (err?.retryAfter) console.log("Retry-After:", err.retryAfter);
  }
}

function startTargetPlacePolling(client) {
  console.log("🔁 Starting presence checks...");
  checkTrackedUsers(client).catch(console.error);
  setInterval(() => checkTrackedUsers(client), CHECK_INTERVAL_MS);
}

// ---------- BOT STARTUP ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  startTargetPlacePolling(client);
});

client.login(TOKEN);
