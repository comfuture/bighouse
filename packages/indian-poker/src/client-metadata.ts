import thumbnailUrl from "./assets/thumbnail.svg?url";
import { baseGameMetadata } from "./metadata";

export const gameMetadata = {
  ...baseGameMetadata,
  thumbnail: {
    src: thumbnailUrl,
    alt: "Two shadowed players at a green felt table, each with a playing card taped to their forehead beside a stack of chips"
  }
};
