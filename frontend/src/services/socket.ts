import client from "./nakamaClient";
import { Session } from "@heroiclabs/nakama-js";

const DEVICE_ID_KEY = "ttt_device_id";
const REAL_NAME_KEY = "ttt_real_name";
const GAME_TAG_KEY  = "ttt_game_tag";

const ADJECTIVES = [
  "Swift","Bold","Brave","Clever","Dark","Fast","Fierce","Wild","Calm","Bright",
  "Sharp","Slick","Cool","Ice","Fire","Storm","Silver","Iron","Jade","Nova",
  "Cyber","Hyper","Shadow","Turbo","Neon","Solar","Frost","Blaze","Dusk","Void",
];
const NOUNS = [
  "Tiger","Eagle","Wolf","Fox","Bear","Hawk","Lion","Dragon","Panda","Falcon",
  "Shark","Viper","Cobra","Phoenix","Ghost","Raven","Titan","Blade","Knight",
  "Ninja","Ranger","Hunter","Warrior","Rider","Storm","Specter","Reaper","Savage",
];

function generateTag(): string {
  const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num  = Math.floor(10 + Math.random() * 90);
  return `${adj}${noun}${num}`;
}

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function getOrCreateGameTag(): string {
  let tag = localStorage.getItem(GAME_TAG_KEY);
  if (!tag) {
    tag = generateTag();
    localStorage.setItem(GAME_TAG_KEY, tag);
  }
  return tag;
}

export function getSavedRealName(): string {
  return localStorage.getItem(REAL_NAME_KEY) || "";
}

export function saveRealName(name: string) {
  localStorage.setItem(REAL_NAME_KEY, name);
}

// Legacy aliases kept for compatibility
export const getSavedUsername = getSavedRealName;
export const saveUsername     = saveRealName;

export async function connect(realName?: string): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  socket: any;
  session: Session;
  gameTag: string;
  userId: string;
}> {
  const deviceId = getOrCreateDeviceId();
  const tag      = getOrCreateGameTag();

  if (realName) saveRealName(realName);

  // Nakama username = game tag (random words); real name never leaves the client
  const session = await client.authenticateDevice(deviceId, true, tag);

  try {
    await client.updateAccount(session, { username: tag, display_name: tag });
  } catch {
    // ignore — username may already be set
  }

  const socket = client.createSocket();
  await socket.connect(session, true);

  return { socket, session, gameTag: tag, userId: session.user_id || "" };
}
