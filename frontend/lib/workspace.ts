"use client";

import { useEffect, useState } from "react";

export type Workspace = "live" | "training";
const KEY = "anvesh.workspace";
const EVT = "anvesh:workspace";

function read(): Workspace {
  try { return localStorage.getItem(KEY) === "training" ? "training" : "live"; } catch { return "live"; }
}

/** Live = real calls taken in this deployment. Training = scripted scenarios, kept fully separate. */
export function useWorkspace(): [Workspace, (w: Workspace) => void] {
  const [ws, setWs] = useState<Workspace>("live");
  useEffect(() => {
    setWs(read());
    const on = () => setWs(read());
    window.addEventListener(EVT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EVT, on); window.removeEventListener("storage", on); };
  }, []);
  const set = (w: Workspace) => {
    try { localStorage.setItem(KEY, w); } catch {}
    setWs(w);
    window.dispatchEvent(new Event(EVT));
  };
  return [ws, set];
}

export function wsParam(ws: Workspace, sep: "?" | "&" = "?"): string {
  return ws === "training" ? `${sep}training=true` : "";
}
