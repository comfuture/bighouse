import { describe, expect, it } from "vitest";
import {
  createChatImeState,
  markCompositionEnd,
  markCompositionStart,
  shouldSubmitChatEnter
} from "../packages/frontend/src/chat-ime";

describe("chat IME enter guard", () => {
  it("does not submit while a composition is active", () => {
    const state = createChatImeState();
    markCompositionStart(state);

    expect(shouldSubmitChatEnter({}, state, 1_000)).toBe(false);
    expect(shouldSubmitChatEnter({ isComposing: true }, createChatImeState(), 1_000)).toBe(false);
    expect(shouldSubmitChatEnter({ keyCode: 229 }, createChatImeState(), 1_000)).toBe(false);
  });

  it("suppresses the enter that immediately follows compositionend", () => {
    const state = createChatImeState();
    markCompositionEnd(state, 1_000);

    expect(shouldSubmitChatEnter({}, state, 1_000)).toBe(false);
    expect(shouldSubmitChatEnter({}, state, 1_079)).toBe(false);
    expect(shouldSubmitChatEnter({}, state, 1_080)).toBe(true);
  });
});
