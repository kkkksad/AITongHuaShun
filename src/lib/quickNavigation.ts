export interface QuickNavigationItem<T extends string = string> {
  id: T;
  label: string;
  group: string;
  title: string;
  keywords: string[];
}

export type QuickNavigationKeyAction<T extends string = string> =
  | { type: "select"; id: T }
  | { type: "highlight"; index: number }
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
  activeIndex = 0,
): QuickNavigationKeyAction<T["id"]> {
  if (key === "Escape") return { type: "close" };
  if (matches.length === 0) return { type: "none" };
  const currentIndex = matches[activeIndex] ? activeIndex : 0;
  if (key === "ArrowDown") {
    return { type: "highlight", index: (currentIndex + 1) % matches.length };
  }
  if (key === "ArrowUp") {
    return { type: "highlight", index: (currentIndex + matches.length - 1) % matches.length };
  }
  if (key === "Enter") return { type: "select", id: matches[currentIndex].id };
  return { type: "none" };
}
