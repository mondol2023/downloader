import type { JSONContent } from "@media/rich-text";

/** One line of plain text per top-level block (lists and tables flatten to their text). */
export function docLines(doc: JSONContent | null | undefined): string[] {
  const text = (n: JSONContent): string =>
    n.type === "text" ? (n.text ?? "") : n.type === "image" ? `[image: ${String(n.attrs?.alt ?? "")}]` : (n.content ?? []).map(text).join(n.type === "paragraph" ? "" : " ");
  return (doc?.content ?? []).map((b) => text(b).trim()).filter(Boolean);
}

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/** Line diff by longest common subsequence: revision pages are small, so O(n·m) is fine. */
export function diffLines(a: string[], b: string[]): DiffLine[] {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ kind: "del", text: a[i++]! });
    else out.push({ kind: "add", text: b[j++]! });
  }
  while (i < a.length) out.push({ kind: "del", text: a[i++]! });
  while (j < b.length) out.push({ kind: "add", text: b[j++]! });
  return out;
}
