import thumbnailUrl from "./assets/thumbnail.png?url";
import { baseGameMetadata } from "./metadata";

export const gameMetadata = {
  ...baseGameMetadata,
  thumbnail: {
    src: thumbnailUrl,
    alt: "Two stylized artillery tanks dueling across a cratered landscape under a twilight sky"
  }
};
