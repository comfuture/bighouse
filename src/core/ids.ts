export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function roomDoName(roomId: string): string {
  return `room:${roomId}`;
}

export function lobbyDoName(gameId: string, mode: string): string {
  return `lobby:${gameId}:${mode}`;
}

export function matchmakerDoName(gameId: string, mode: string, region = "global", skill = "default"): string {
  return `matchmaker:${gameId}:${mode}:${region}:${skill}`;
}
