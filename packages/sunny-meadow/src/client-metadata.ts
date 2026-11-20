import type { GameMetadata } from "@bighouse/game-sdk/client";
import thumbnailUrl from "./assets/thumbnail.png?url";
import { baseGameMetadata } from "./metadata";

export const gameMetadata: GameMetadata = {
  ...baseGameMetadata,
  thumbnail: {
    src: thumbnailUrl,
    alt: "햇살 초원 모험 횡스크롤 플랫포머 썸네일"
  }
};
