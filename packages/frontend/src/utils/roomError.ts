export type ServerErrorPayload = {
  code?: string;
  message?: string;
};

export type RoomErrorDisposition = {
  /** Whether to show the top room-level alert banner (only for critical/fatal room states). */
  showBanner: boolean;
  bannerMessage?: string;
  /** Whether to notify the mounted game via actionError so pending UI controls unlock cleanly. */
  forwardActionError: boolean;
  /** Message forwarded to the game client (empty string triggers silent local recovery). */
  actionErrorMessage: string;
};

const CRITICAL_ACTIVE_ROOM_CODES = new Set(["room_closed", "room_not_found"]);

const SILENT_RECOVERY_CODES = new Set(["stale_action", "game_interrupted"]);

const SILENT_SUGGESTION_MESSAGES = new Set([
  "This suggestion is no longer valid",
  "Game suggestions are unavailable",
  "Please wait before sending another suggestion"
]);

/**
 * Classifies server `{ type: "error" }` messages so non-critical gameplay or transient
 * signal/suggestion rejections never leave a sticky red banner at the top of the screen.
 */
export function classifyRoomError(
  payload: ServerErrorPayload | null | undefined,
  gameReady: boolean
): RoomErrorDisposition {
  const code = typeof payload?.code === "string" ? payload.code : "";
  const message =
    typeof payload?.message === "string" && payload.message.trim().length > 0
      ? payload.message.trim()
      : "Room error";

  // Before the game mounts, show join/room errors on the loading card so the user can return to lobby.
  if (!gameReady) {
    return {
      showBanner: true,
      bannerMessage: message,
      forwardActionError: false,
      actionErrorMessage: ""
    };
  }

  // Once playing, only truly fatal room-ending errors warrant the top banner.
  if (CRITICAL_ACTIVE_ROOM_CODES.has(code)) {
    return {
      showBanner: true,
      bannerMessage: message,
      forwardActionError: false,
      actionErrorMessage: ""
    };
  }

  // Stale versions, expired suggestions, and transient signal drops recover silently
  // without surfacing distracting error text while still unlocking any pending local controls.
  if (SILENT_RECOVERY_CODES.has(code) || SILENT_SUGGESTION_MESSAGES.has(message)) {
    return {
      showBanner: false,
      forwardActionError: true,
      actionErrorMessage: ""
    };
  }

  // Other non-critical gameplay rejections stay out of the global red banner;
  // forward to the mounted game adapter so it can recover or show inline feedback if desired.
  return {
    showBanner: false,
    forwardActionError: true,
    actionErrorMessage: message
  };
}
