import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "../api/client";
import type { Settings } from "../api/types";

const defaults: Settings = {
  shopName: "[Shop name]", tagline: "Jewellery for every day and every occasion.",
  phone: "", whatsapp: "", email: "", address: "",
  deliveryFee: 450, freeDeliveryOver: null, bankDetails: "",
  codEnabled: true, bankEnabled: true, onlineEnabled: false, pickupEnabled: true,
  themeMode: "system", themeAccent: "emerald",
};

const accents = {
  emerald: { light: ["#0e5a45", "#0a4636", "#dcebe4", "#5e8f7f", "#ffffff"], dark: ["#4fbf97", "#6fd0ad", "#173a2f", "#3e7f6a", "#06130e"] },
  gold: { light: ["#8a5c12", "#68430b", "#f3e8cf", "#a8874a", "#ffffff"], dark: ["#e5b85c", "#f1cc7e", "#3b2e17", "#a8874a", "#211707"] },
  rose: { light: ["#a33f58", "#812b42", "#f5e0e6", "#b56f82", "#ffffff"], dark: ["#f07e97", "#ff9aae", "#3e2029", "#b56f82", "#260b12"] },
  blue: { light: ["#315f9c", "#244775", "#e0e9f5", "#6f8eb8", "#ffffff"], dark: ["#82aef0", "#a4c4f6", "#1d2e47", "#6f8eb8", "#09162a"] },
} as const;

type Ctx = { settings: Settings; reload: () => Promise<void> };
const SettingsContext = createContext<Ctx>({ settings: defaults, reload: async () => undefined });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaults);
  const reload = async () => {
    const data = await api.settings();
    // Keep defaults for anything the server doesn't send (for example an older backend).
    if (data && typeof data === "object" && !Array.isArray(data)) setSettings({ ...defaults, ...data });
  };

  useEffect(() => { reload().catch(() => undefined); }, []);
  useEffect(() => { document.title = settings.shopName.replace(/^\[|\]$/g, "") || "Jewellery"; }, [settings.shopName]);
  useEffect(() => {
    const root = document.documentElement;
    if (settings.themeMode === "system") delete root.dataset.theme;
    else root.dataset.theme = settings.themeMode;
    const palette = accents[settings.themeAccent] ?? accents.emerald;
    for (const mode of ["light", "dark"] as const) {
      const [accent, accent2, soft, muted, onAccent] = palette[mode];
      root.style.setProperty(`--accent-${mode}`, accent);
      root.style.setProperty(`--accent-2-${mode}`, accent2);
      root.style.setProperty(`--accent-soft-${mode}`, soft);
      root.style.setProperty(`--accent-muted-${mode}`, muted);
      root.style.setProperty(`--on-accent-${mode}`, onAccent);
    }
    const apply = () => {
      const mode = settings.themeMode === "system"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : settings.themeMode;
      root.style.colorScheme = mode;
      root.style.setProperty("--accent", `var(--accent-${mode})`);
      root.style.setProperty("--accent-2", `var(--accent-2-${mode})`);
      root.style.setProperty("--accent-soft", `var(--accent-soft-${mode})`);
      root.style.setProperty("--accent-muted", `var(--accent-muted-${mode})`);
      root.style.setProperty("--on-accent", `var(--on-accent-${mode})`);
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.themeMode, settings.themeAccent]);

  return <SettingsContext.Provider value={{ settings, reload }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext).settings;
export const useReloadSettings = () => useContext(SettingsContext).reload;
