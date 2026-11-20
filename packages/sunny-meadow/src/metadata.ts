import type { GameMetadata } from "@bighouse/game-sdk/server";

export const baseGameMetadata: GameMetadata = {
  gameId: "sunny-meadow",
  adapterKey: "sunny-meadow",
  displayName: "햇살 초원 모험",
  description: "수백 명이 함께 뛰노는 10개 스테이지 횡스크롤 액션 RPG 플랫포머! 몬스터 사냥·레벨업·무기 수집·비밀 포털을 탐험하세요.",
  minPlayers: 1,
  maxPlayers: 500,
  supportsBots: false,
  persistentWorld: true,
  fixedRooms: [
    {
      roomId: "room_sunny_clover",
      name: "클로버 초원 (채널 1)",
      description: "햇살 가득한 모험가들의 메인 광장",
      mode: "default"
    },
    {
      roomId: "room_sunny_acorn",
      name: "도토리 숲 (채널 2)",
      description: "숲속 햄스터와 토끼가 뛰노는 여유로운 숲 채널",
      mode: "default"
    },
    {
      roomId: "room_sunny_starlight",
      name: "별빛 언덕 (채널 3)",
      description: "별빛 드래곤의 전설이 깃든 고요한 별빛 채널",
      mode: "default"
    }
  ]
};

