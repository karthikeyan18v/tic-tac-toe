import { Client } from "@heroiclabs/nakama-js";

const useSSL = import.meta.env.VITE_NAKAMA_SSL === "true" || window.location.protocol === "https:";
const host = import.meta.env.VITE_NAKAMA_HOST || "127.0.0.1";
const port = import.meta.env.VITE_NAKAMA_PORT || "7350";
const serverKey = import.meta.env.VITE_NAKAMA_KEY || "defaultkey";

const client = new Client(serverKey, host, port, useSSL);

export default client;
