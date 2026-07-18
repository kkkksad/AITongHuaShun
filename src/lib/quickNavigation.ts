export interface QuickNavigationItem<T extends string = string> {
  id: T;
  label: string;
  group: string;
  title: string;
  keywords: string[];
}

export type QuickNavigationKeyAction<T extends string = string> =
  | { type: "select"; id: T }
  | { type: "close" }
  | { type: "none" };

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function filterQuickNavigationItems<T extends QuickNavigationItem>(
  items: T[],
  query: string,
): T[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return items;

  return items.filter((item) => normalize([
    item.label,
    item.group,
    item.title,
    ...item.keywords,
  ].join(" ")).includes(normalizedQuery));
}

export function getQuickNavigationKeyAction<T extends QuickNavigationItem>(
  key: string,
  matches: T[],
): QuickNavigationKeyAction<T["id"]> {
  if (key === "Escape") return { type: "close" };
  if (key === "Enter" && matches[0]) return { type: "select", id: matches[0].id };
  return { type: "none" };
}