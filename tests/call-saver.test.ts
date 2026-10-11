import { describe, expect, it, vi } from "vitest";
import { callSaver } from "../src/lib/call-saver";

// A server that finishes requests in reverse order, like the race that stored "3" for "32".
function slowFirst() {
  const stored = new Map<string, [number, number]>();
  const calls: [number, number][] = [];
  let n = 0;
  const send = (k: string, v: [number, number]) => {
    calls.push(v);
    const wait = n++ === 0 ? 50 : 1;
    return new Promise<string | null>((r) => setTimeout(() => { stored.set(k, v); r(null); }, wait));
  };
  return { stored, calls, send };
}

describe("call saver", () => {
  it("stores the last thing typed even when saves would finish out of order", async () => {
    vi.useFakeTimers();
    const srv = slowFirst();
    const states: string[] = [];
    const s = callSaver<[number, number]>({ send: srv.send, onState: (_, st) => states.push(st), delay: 0 });
    s.set("m", [28, 3]);
    await vi.advanceTimersByTimeAsync(0); // the "3" save is in flight
    s.set("m", [28, 32]);
    await vi.advanceTimersByTimeAsync(200);
    expect(srv.stored.get("m")).toEqual([28, 32]);
    expect(srv.calls).toEqual([[28, 3], [28, 32]]);
    expect(states.at(-1)).toBe("saved");
    vi.useRealTimers();
  });

  it("sends only the final value when typing is quick", async () => {
    vi.useFakeTimers();
    const srv = slowFirst();
    const s = callSaver<[number, number]>({ send: srv.send, onState: () => {} });
    s.set("m", [3, 18]);
    s.set("m", [33, 18]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(srv.calls).toEqual([[33, 18]]);
    vi.useRealTimers();
  });

  it("says when a save fails and retries the same call", async () => {
    vi.useFakeTimers();
    let fail = true;
    const sent: [number, number][] = [];
    const states: string[] = [];
    const s = callSaver<[number, number]>({
      send: async (_, v) => { sent.push(v); return fail ? "Network error" : null; },
      onState: (_, st) => states.push(st), delay: 0,
    });
    s.set("m", [19, 32]);
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toBe("failed");
    fail = false;
    await s.flush("m");
    expect(sent).toEqual([[19, 32], [19, 32]]);
    expect(states.at(-1)).toBe("saved");
    vi.useRealTimers();
  });
});
