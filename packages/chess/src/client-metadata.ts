import thumbnailUrl from "./assets/thumbnail.png?url";
import { baseGameMetadata } from "./metadata";

export const gameMetadata = {
  ...baseGameMetadata,
  thumbnail: {
    src: thumbnailUrl,
    alt: "Casual digital art of chess pieces on a checkerboard"
  }
};
