import { describe, expect, it } from "vitest";
import { installHow } from "../src/lib/install";

const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const chromeIos = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1";
const fbIos = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.0]";
const chromeAndroid = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const webview = "Mozilla/5.0 (Linux; Android 14; SM-S918B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36";
const samsung = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36";
const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

describe("installHow", () => {
  it("iPhone Safari", () => expect(installHow(safari)).toBe("ios-safari"));
  it("iPad that reports itself as a Mac", () => expect(installHow(mac, "MacIntel", 5)).toBe("ios-safari"));
  it("Chrome on iPhone", () => expect(installHow(chromeIos)).toBe("ios-other"));
  it("Facebook's in-app browser", () => expect(installHow(fbIos)).toBe("in-app"));
  it("an Android app's web view", () => expect(installHow(webview)).toBe("in-app"));
  it("Chrome and Samsung on Android", () => {
    expect(installHow(chromeAndroid)).toBe("android");
    expect(installHow(samsung)).toBe("android");
  });
  it("a Mac", () => expect(installHow(mac, "MacIntel", 0)).toBe("desktop"));
});
