import type { Connection } from "../types";
const STORAGE_KEY = "margin-local-credentials-v1";
export function credentialId(c: Connection, slot = "writing") {
  return `${slot}:${c.kind}:${c.url.trim().replace(/\/+$/, "")}`;
}
export function readCredentials(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}
export function saveCredentials(value: Record<string, string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}
