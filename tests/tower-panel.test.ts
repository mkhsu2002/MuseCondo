import test from "node:test";
import assert from "node:assert/strict";
import { bindTowerPanel, type Residency } from "../src/live/tower-panel.ts";
import type { PublicDailyEntry } from "../src/framework/types.ts";

const resident: Residency = {
  roomId: "a".repeat(16), door: "/home/" + "a".repeat(16),
  sourceURL: "https://source.example/home/condo.json", revision: 3,
  publicRevision: 1, published: true, directoryConsent: false,
  announcementConsent: false, dreamConsent: false, snapshotConsent: true,
};

// Exercise the bound preview form and the markup it presents, without a browser
// identity or an extra DOM dependency. Only the used DOM surface is simulated.
class FormSurface {
  button = { disabled: false };
  dataset: Record<string, string> = {};
  listeners = new Map<string, (event: { preventDefault(): void; currentTarget: FormSurface }) => Promise<void>>();
  querySelector(selector: string) { return selector === "button" ? this.button : null; }
  addEventListener(type: string, listener: (event: { preventDefault(): void; currentTarget: FormSurface }) => Promise<void>) {
    this.listeners.set(type, listener);
  }
  async submit() {
    const handler = this.listeners.get("submit");
    assert.ok(handler, "preview form must be bound");
    await handler({ preventDefault() {}, currentTarget: this });
  }
}
async function previewDaily(before: PublicDailyEntry[], after: PublicDailyEntry[]) {
  const refresh = new FormSurface(), apply = new FormSurface(), status = { textContent: "" };
  const box = { innerHTML: "", textContent: "", querySelector: (selector: string) => selector === "form" ? apply : null };
  const root = { querySelector: (selector: string) => ({
    "#tower-refresh": refresh, "#tower-source-review": box,
    "#tower-source-apply": apply, ".live-status": status,
  } as Record<string, unknown>)[selector] ?? null };
  const requests: { url: string; method?: string; body?: unknown }[] = [];
  const api = async <T>(url: string, method?: string, body?: unknown): Promise<T> => {
    requests.push({ url, method, body });
    return { baseRevision: 3, sourceDigest: "b".repeat(64), groups: [{
      field: "daily", changed: true, before, after,
    }] } as T;
  };
  bindTowerPanel(root as unknown as HTMLElement, resident, api, async () => { assert.fail("preview must not reload or save"); });
  await refresh.submit();
  assert.equal(status.textContent, "");
  assert.deepEqual(requests, [{ url: "/api/v1/me/tower-intake/source-preview", method: "POST", body: { expectedRevision: 3 } }]);
  return box.innerHTML;
}
const entry: PublicDailyEntry = {
  id: "same-entry", type: "journal", title: "相同標題", body: "相同內容",
  occurredAt: "2026-10-30T00:00:00Z",
};

test("type-only source changes visibly distinguish the current daily entry from its collection replacement", async () => {
  const html = await previewDaily([entry], [{ ...entry, type: "artwork" }]);
  const panels = [...html.matchAll(/<pre>(.*?)<\/pre>/gs)].map(match => match[1]);
  assert.equal(panels.length, 2);
  assert.notEqual(panels[0], panels[1], "type-only changes must not render identical before/after text");
  assert.match(panels[0], /類型：日記/);
  assert.match(panels[1], /類型：作品（隨身收藏）/);
  for (const panel of panels) for (const text of [entry.title, entry.body, entry.occurredAt]) assert.ok(panel.includes(text));
  assert.match(html, /日常：有差異/);
  assert.match(html, /name="apply" value="daily"/);
  assert.doesNotMatch(html, /\bchecked\b|sourceDigest|imageDigest/);
  assert.match(html, /<button type="submit" disabled>/);
});

test("every supported daily type uses a Chinese product label and imported text remains escaped", async () => {
  for (const [type, label] of [
    ["journal", "日記"], ["status", "近況"], ["seeking", "想認識誰"],
    ["artwork", "作品（隨身收藏）"], ["observation", "觀察"],
  ] as const) {
    const html = await previewDaily([], [{ ...entry, type, title: "<script>不執行</script>" }]);
    assert.ok(html.includes("類型：" + label));
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;不執行&lt;\/script&gt;/);
    assert.ok(!html.includes("類型：" + type));
  }
});
