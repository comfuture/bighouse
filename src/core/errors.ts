export type ErrorCode =
  | "bad_request"
  | "game_not_found"
  | "room_not_found"
  | "room_full"
  | "room_closed"
  | "player_not_found"
  | "forbidden"
  | "invalid_room_phase"
  | "not_enough_players"
  | "players_not_ready"
  | "game_interrupted"
  | "duplicate_action"
  | "stale_action"
  | "invalid_action"
  | "invalid_turn"
  | "internal_error";

export class GameServerError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status = 400,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "GameServerError";
  }
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof GameServerError || isGameServerErrorLike(error)) {
    return Response.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status }
    );
  }

  console.error("Unhandled request error", error);
  return Response.json(
    { error: { code: "internal_error", message: "Internal server error" } },
    { status: 500 }
  );
}

function isGameServerErrorLike(error: unknown): error is GameServerError {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: unknown; message?: unknown; status?: unknown };
  return typeof candidate.code === "string" && typeof candidate.message === "string" && typeof candidate.status === "number";
}
