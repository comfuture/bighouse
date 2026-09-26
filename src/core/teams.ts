import type { GameDefinition, GameTeam, RoomState } from "./game";
import { cloneState } from "./game";
import { GameServerError } from "./errors";

export function roomTeams(state: RoomState, definition: GameDefinition): GameTeam[] {
  const teams = definition.getTeams?.({ state: cloneState(state), now: Date.now() }) ?? [];
  const members = new Set(state.players.map((player) => player.playerId));
  const seenPlayers = new Set<string>();
  const seenTeams = new Set<string>();
  // Ambiguous membership fails closed, including adapters accidentally returning
  // two teams for one player. Removed players can never remain recipients.
  for (const team of teams) {
    if (!team.teamId || seenTeams.has(team.teamId)) return [];
    seenTeams.add(team.teamId);
    for (const playerId of team.playerIds) {
      if (seenPlayers.has(playerId)) return [];
      seenPlayers.add(playerId);
    }
  }
  return teams.map((team) => ({ ...team, playerIds: team.playerIds.filter((id) => members.has(id)) }));
}

export function requirePlayerTeam(state: RoomState, definition: GameDefinition, playerId: string): GameTeam {
  const team = roomTeams(state, definition).find((candidate) => candidate.playerIds.includes(playerId));
  if ((state.phase !== "active" && state.phase !== "finished") || state.activeInterruption || !team || team.playerIds.length < 2) {
    throw new GameServerError("invalid_action", "Team messaging is unavailable for this player", 409);
  }
  return team;
}
