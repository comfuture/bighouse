import iconSet from "@iconify-json/lucide/icons.json";

type IconName = "message-circle" | "send" | "x";

export function iconMarkup(name: IconName): string {
  const icon = iconSet.icons[name];
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icon?.body ?? ""}</svg>`;
}
