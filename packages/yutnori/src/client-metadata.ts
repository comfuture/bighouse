import thumbnailUrl from "./assets/thumbnail.svg?url";
import { baseGameMetadata } from "./metadata";
export const gameMetadata = {
  ...baseGameMetadata,
  thumbnail: { src: thumbnailUrl, alt: "밝은 윷판 위 파란 원형 말과 붉은 사각형 말, 네 개의 윷가락" }
};
