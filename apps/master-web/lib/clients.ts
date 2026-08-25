import { readFile } from "fs/promises";
import { join } from "path";
import type { ClientRecord } from "./types";

const CLIENTS_PATHS = [
  process.env.CLIENTS_JSON_PATH,
  join(process.cwd(), "data/clients.json"),
  join(process.cwd(), "../../data/clients.json"),
].filter(Boolean) as string[];

export async function loadClients(): Promise<ClientRecord[]> {
  for (const path of CLIENTS_PATHS) {
    try {
      const raw = await readFile(path, "utf8");
      const data = JSON.parse(raw) as ClientRecord[] | { clients: ClientRecord[] };
      if (Array.isArray(data)) return data;
      if (data && "clients" in data && Array.isArray(data.clients)) return data.clients;
    } catch {
      /* try next path */
    }
  }
  return [];
}

export async function getClientById(id: string): Promise<ClientRecord | null> {
  const clients = await loadClients();
  return clients.find((c) => c.id === id) ?? null;
}
