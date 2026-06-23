// Plain-text helpers for coaching card content. No markdown renderer.

export function stripMarkdown(input: string): string {
  if (!input) return "";
  let s = input.replace(/\r\n/g, "\n");
  // Remove leading header markers (#, ##, ###, ...) at line start
  s = s.replace(/^[ \t]*#{1,6}[ \t]*/gm, "");
  // Remove bold/italic markers: **text**, *text*, __text__, _text_
  s = s.replace(/\*\*/g, "");
  s = s.replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2");
  s = s.replace(/__/g, "");
  // Strip backticks for inline code
  s = s.replace(/`+/g, "");
  // Trim trailing whitespace per line
  s = s
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n");
  return s.trim();
}

// Covers common emoji blocks plus the specific glyphs called out
// (❌ ✅ ⚠️ 🕐 📊 💡 📈 🏆 etc.) and variation selectors / ZWJ.
const EMOJI_RE =
  /[\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDDFF]|\uFE0F|\u200D/g;

export function stripEmojis(input: string): string {
  if (!input) return "";
  return input.replace(EMOJI_RE, "").replace(/[ \t]{2,}/g, " ").replace(/ +([,.!?:;])/g, "$1");
}

export function cleanCardText(input: string | null | undefined): string {
  return stripEmojis(stripMarkdown(input ?? ""));
}

export function firstSentence(input: string | null | undefined): string {
  const cleaned = cleanCardText(input);
  if (!cleaned) return "";
  const match = cleaned.match(/^[\s\S]*?[.!?\n]/);
  if (!match) return cleaned;
  return match[0].replace(/[.!?\s]+$/g, "").trim();
}
