import thumbnailUrl from "./assets/thumbnail.png?url";
import { baseGameMetadata } from "./metadata";

export const gameMetadata = {
  ...baseGameMetadata,
  thumbnail: {
    src: thumbnailUrl,
    alt: "Beautiful digital illustration of a green poker felt table with glowing Ace of Spades and Joker playing cards."
  }
};
