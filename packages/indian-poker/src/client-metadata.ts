import thumbnailUrl from "./assets/thumbnail.png?url";
import { baseGameMetadata } from "./metadata";

export const gameMetadata = {
  ...baseGameMetadata,
  thumbnail: {
    src: thumbnailUrl,
    alt: "Two illustrated parlor gamblers facing off across a candlelit emerald poker table with playing cards on their foreheads and glowing chips between them"
  }
};
