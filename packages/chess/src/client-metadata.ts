import thumbnailUrl from "./assets/pieces/wN.svg?url";
import { baseGameMetadata } from "./metadata";

export const gameMetadata = {
  ...baseGameMetadata,
  thumbnail: {
    src: thumbnailUrl,
    alt: "White knight chess piece from Wikimedia Commons"
  }
};
