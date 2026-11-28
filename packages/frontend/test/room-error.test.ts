import { describe, expect, it } from "vitest";
import { classifyRoomError } from "../src/utils/roomError";

describe("RoomView error classification & graceful recovery", () => {
  it("never shows the top red banner for stale suggestions, rate limits, or non-critical gameplay errors once mounted", () => {
    const staleSuggestion = classifyRoomError(
      { code: "invalid_action", message: "This suggestion is no longer valid" },
      true
    );
    expect(staleSuggestion.showBanner).toBe(false);
    expect(staleSuggestion.forwardActionError).toBe(true);
    expect(staleSuggestion.actionErrorMessage).toBe("");

    const unavailableSuggestion = classifyRoomError(
      { code: "invalid_action", message: "Game suggestions are unavailable" },
      true
    );
    expect(unavailableSuggestion.showBanner).toBe(false);
    expect(unavailableSuggestion.actionErrorMessage).toBe("");

    const rateLimited = classifyRoomError(
      { code: "invalid_action", message: "Please wait before sending another suggestion" },
      true
    );
    expect(rateLimited.showBanner).toBe(false);
    expect(rateLimited.actionErrorMessage).toBe("");

    const staleVersion = classifyRoomError(
      { code: "stale_action", message: "Action expectedVersion does not match room version" },
      true
    );
    expect(staleVersion.showBanner).toBe(false);
    expect(staleVersion.forwardActionError).toBe(true);
    expect(staleVersion.actionErrorMessage).toBe("");

    const invalidTurn = classifyRoomError({ code: "invalid_turn", message: "Not your turn" }, true);
    expect(invalidTurn.showBanner).toBe(false);
    expect(invalidTurn.forwardActionError).toBe(true);
    expect(invalidTurn.actionErrorMessage).toBe("Not your turn");
  });

  it("shows the top banner only for critical room-ending errors when active, and for join failures before mount", () => {
    const closed = classifyRoomError({ code: "room_closed", message: "Room is closed" }, true);
    expect(closed.showBanner).toBe(true);
    expect(closed.bannerMessage).toBe("Room is closed");
    expect(closed.forwardActionError).toBe(false);

    const notFound = classifyRoomError({ code: "room_not_found", message: "Room not found" }, true);
    expect(notFound.showBanner).toBe(true);
    expect(notFound.bannerMessage).toBe("Room not found");

    const joinFull = classifyRoomError({ code: "room_full", message: "Room is full" }, false);
    expect(joinFull.showBanner).toBe(true);
    expect(joinFull.bannerMessage).toBe("Room is full");
  });
});
