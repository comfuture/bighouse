import thumbnailUrl from "./assets/thumbnail.svg?url";
import { baseGameMetadata } from "./metadata";

export const gameMetadata = {
  ...baseGameMetadata,
  thumbnail: {
    src: thumbnailUrl,
    alt: "Two colorful tanks firing across a cratered landscape under a windy night sky"
  }
};
