// ---------- DEPENDENCIES ----------
import 'dotenv/config';
import express from 'express';
import { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder 
} from "discord.js";
import fetch from "node-fetch";

// ---------- CONFIG ----------
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const ROBLOX_COOKIE = process.env.ROBLOX_COOKIE;
const TRACKED_USER_IDS = ["909635"];
const TARGET_UNIVERSE_ID = 5750914919;
const CHECK_INTERVAL_MS = 5000;
const DISCORD_CHANNEL_ID = "1428208748513595392";

const lastStatus = new Map();
let csrfToken = null;

// ---------- EXPRESS SERVER (for Render Port) ----------
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('🤖 Discord Bot is running'));
app.listen(PORT, () => console.log(`🌐 Express server listening on port ${PORT}`));

// ---------- Get CSRF Token ----------
async function getCsrfToken() {
  const res = await fetch("https://auth.roblox.com/v2/logout", {
    method: "POST",
    headers: {
      "Cookie": `.ROBLOSECURITY=${ROBLOX_COOKIE}`,
    },
  });

  const token = res.headers.get("x-csrf-token");
  if (!token) throw new Error("Failed to obtain X-CSRF-TOKEN from Roblox");
  csrfToken = token;
  console.log("✅ CSRF token retrieved");
}

// ---------- Presence Fetch ----------
async function fetchPresenceFor(userIds) {
  if (!csrfToken) await getCsrfToken();

  const res = await fetch("https://presence.roblox.com/v1/presence/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": `.ROBLOSECURITY=${ROBLOX_COOKIE}`,
      "x-csrf-token": csrfToken,
      "User-Agent": "RobloxTrackerBot/1.0"
    },
    body: JSON.stringify({ userIds: userIds.map(id => parseInt(id, 10)) }),
  });

  if (res.status === 403 && res.headers.get("x-csrf-token")) {
    csrfToken = res.headers.get("x-csrf-token");
    console.log("🔁 Refreshed CSRF token, retrying request...");
    return await fetchPresenceFor(userIds);
  }

  if (!res.ok) throw new Error(`Presence request failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.userPresences || [];
}

// ---------- Core Tracking ----------
async function checkTrackedUsers(client) {
  try {
    console.log("Checking presences for users:", TRACKED_USER_IDS);
    const presences = await fetchPresenceFor(TRACKED_USER_IDS);
    console.log("Presence data received:", presences);

    for (const p of presences) {
      const userId = String(p.userId);
      const isInTarget = p.universeId === TARGET_UNIVERSE_ID;
      const wasInTarget = lastStatus.get(userId) || false;

      if (!wasInTarget && isInTarget) {
        await sendNotification(client, userId, "joined", p.lastLocation);
      } else if (wasInTarget && !isInTarget) {
        await sendNotification(client, userId, "left", p.lastLocation);
      }

      lastStatus.set(userId, isInTarget);
    }
  } catch (err) {
    console.error("Error checking presence:", err.message);
  }
}

// ---------- Discord Notification ----------
async function sendNotification(client, userId, action, location) {
  const channel = await client.channels.fetch(DISCORD_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.send) {
    console.log("❌ Notification channel not found or cannot send messages.");
    return;
  }

  const profileUrl = `https://www.roblox.com/users/${userId}/profile`;
  const placeUrl = `https://www.roblox.com/games/${TARGET_UNIVERSE_ID}`;
  const msg =
    `🔔 Roblox user **${userId}** ${action} the game **Fisch 🐟**` +
    (location ? `: **${location}**` : "") +
    `\n🔗 ${placeUrl}\n👤 ${profileUrl}`;

  await channel.send(msg).catch(console.error);
  console.log(`Notification sent for user ${userId}: ${action}`);
}

// ---------- Polling ----------
function startPolling(client) {
  console.log("🔁 Starting presence checks...");
  checkTrackedUsers(client).catch(console.error);
  setInterval(() => checkTrackedUsers(client), CHECK_INTERVAL_MS);
}

// ---------- Slash Command Registration ----------
const rest = new REST({ version: "10" }).setToken(TOKEN);
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Replies with Pong!"),
  ].map(cmd => cmd.toJSON());

  try {
    console.log("📡 Registering slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Slash commands registered!");
  } catch (err) {
    console.error("Error registering slash commands:", err);
  }
}

// ---------- Slash Command Handler ----------
async function handleSlashCommand(interaction) {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "ping") {
    await interaction.reply("🏓 Pong!");
  }
}

// ---------- BOT STARTUP ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  startPolling(client);
});

client.on("interactionCreate", handleSlashCommand);

// ---------- INIT ----------
await registerCommands();
client.login(TOKEN);
