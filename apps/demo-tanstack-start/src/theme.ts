export const THEME_COOKIE_NAME = "fig-demo-theme";

export type ThemePreference = "dark" | "light" | "system";

export function setBrowserThemePreference(theme: ThemePreference): void {
  document.cookie = `${THEME_COOKIE_NAME}=${encodeURIComponent(theme)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  const root = document.documentElement;
  root.classList.remove("light", "dark", "system");
  root.classList.add(theme);
}

export function themeFromCookie(cookie: string | null): ThemePreference {
  for (const part of (cookie ?? "").split(";")) {
    const [name, ...rawValue] = part.trim().split("=");
    if (name !== THEME_COOKIE_NAME) continue;

    let value = rawValue.join("=");
    try {
      value = decodeURIComponent(value);
    } catch {}

    if (value === "dark" || value === "light" || value === "system") {
      return value;
    }
  }

  return "system";
}
