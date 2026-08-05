import { describe, expect, it } from "vitest";
import { webglAvatarsEnabled, WEBGL_AVATARS_PARAM } from "./flags";

describe("the Layer C staging flag", () => {
  it("is on by default, with no query string at all", () => {
    expect(webglAvatarsEnabled("")).toBe(true);
    expect(webglAvatarsEnabled("?table=abc")).toBe(true);
  });

  it("stays on from a bare parameter, which is what anyone types by hand", () => {
    expect(webglAvatarsEnabled(`?${WEBGL_AVATARS_PARAM}`)).toBe(true);
    expect(webglAvatarsEnabled(`?${WEBGL_AVATARS_PARAM}=`)).toBe(true);
    expect(webglAvatarsEnabled(`?${WEBGL_AVATARS_PARAM}=1`)).toBe(true);
  });

  it("can still be turned off by a link, as a kill switch", () => {
    expect(webglAvatarsEnabled(`?${WEBGL_AVATARS_PARAM}=0`)).toBe(false);
    expect(webglAvatarsEnabled(`?${WEBGL_AVATARS_PARAM}=false`)).toBe(false);
    expect(webglAvatarsEnabled(`?${WEBGL_AVATARS_PARAM}=FALSE`)).toBe(false);
  });

  it("reads the flag alongside the parameters the table already uses", () => {
    expect(webglAvatarsEnabled(`?table=abc&${WEBGL_AVATARS_PARAM}=1&foo=2`)).toBe(true);
    expect(webglAvatarsEnabled(`?table=abc&${WEBGL_AVATARS_PARAM}=0&foo=2`)).toBe(false);
    expect(webglAvatarsEnabled(`table=abc&${WEBGL_AVATARS_PARAM}`)).toBe(true);
  });
});
