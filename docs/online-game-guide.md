# Bighouse로 온라인 게임 만들기

이 문서는 Bighouse 게임 서버를 이용해 온라인 멀티플레이어 게임을 만드는 방법을 설명한다. 핵심은 모든 게임을 같은 네트워크 흐름으로 다루되, 게임별 규칙과 공개/비공개 상태 정책은 `GameDefinition` 어댑터에 맡기는 것이다.

## 1. 기본 흐름

클라이언트가 게임에 참가하는 흐름은 모든 게임에서 같다.

1. `GET /games`로 서버가 제공하는 게임 목록을 가져온다.
2. 로비 즉시 입장 또는 매치메이킹 티켓 생성 중 하나를 선택한다.
3. 응답으로 받은 `roomId`와 `wsUrl`을 사용해 WebSocket에 연결한다.
4. 서버의 `snapshot` 메시지로 현재 룸 상태를 렌더링한다.
5. 플레이어 입력을 `action` 메시지로 보낸다.
6. 서버의 `ack`, `event`, `privateEvent`, `presence`, `error` 메시지를 반영한다.

로비 입장 예시:

```sh
curl -X POST https://bighouse.comfuture.workers.dev/games/gomoku/lobbies/default/join \
  -H 'content-type: application/json' \
  -d '{"playerId":"p1","displayName":"Alice"}'
```

매치메이킹 예시:

```sh
curl -X POST https://bighouse.comfuture.workers.dev/games/gomoku/matchmaking/tickets \
  -H 'content-type: application/json' \
  -d '{"playerId":"p1","mode":"ranked","region":"apac","skill":"beginner"}'
```

응답의 `wsUrl`은 다음과 같은 형태다.

```text
wss://bighouse.comfuture.workers.dev/rooms/room_id/ws?playerId=p1
```

## 2. 클라이언트 메시지 계약

WebSocket 연결 후 클라이언트는 JSON 메시지를 보낸다.

초기 식별 또는 재접속:

```json
{
  "type": "hello",
  "playerId": "p1",
  "displayName": "Alice"
}
```

게임 액션:

```json
{
  "type": "action",
  "playerId": "p1",
  "clientActionId": "move-1",
  "expectedVersion": 2,
  "action": {
    "type": "placeStone",
    "payload": { "x": 0, "y": 0 }
  }
}
```

중요한 필드:

- `clientActionId`: 같은 플레이어가 같은 액션을 재전송해도 한 번만 적용하기 위한 id다.
- `expectedVersion`: 클라이언트가 기준으로 삼은 룸 버전이다. 서버의 현재 버전과 다르면 stale action으로 거부된다.
- `action.type`: 게임 어댑터가 해석하는 게임별 명령이다.
- `action.payload`: 게임별 명령 데이터다.

서버 메시지는 항상 `roomId`, `version`, `serverTime`을 포함한다. 클라이언트는 `snapshot`으로 전체 화면을 갱신하고, 이후 `event` / `privateEvent`를 누적 반영하면 된다.

## 3. 공개 상태와 비공개 상태

Bighouse의 룸 상태는 크게 세 층으로 나뉜다.

`stageState`

- 게임판, 현재 턴, 라운드, 제한시간처럼 방 전체에 속한 상태다.
- 반드시 전부 공개할 필요는 없다.
- `getPublicView()`가 공개 가능한 부분만 골라 클라이언트에 보낸다.

`playerStates`

- 플레이어별 상태다.
- 손패, 비밀 목표, 숨겨진 자원, 개인 버프처럼 다른 플레이어에게 보이면 안 되는 정보를 둔다.
- `getPrivateView(context, playerId)`가 해당 플레이어에게만 보낼 상태를 만든다.

`events`

- 상태 변화의 결과를 클라이언트에 알리는 메시지다.
- `visibility`가 `public`, `private`, `system` 중 하나다.
- `public`과 `system` 이벤트는 모든 플레이어에게 가고, `private` 이벤트는 지정된 `playerId`에게만 간다.

이 구분을 지키는 것이 온라인 게임 구현에서 가장 중요하다. 서버 내부에는 전체 권위 상태가 있어도, 클라이언트에 보내는 view와 event는 게임 규칙에 맞게 필터링해야 한다.

## 4. Gomoku: 전역 게임 상태가 공개되는 게임

오목/바둑/체스처럼 모든 플레이어가 같은 판을 보는 게임은 대부분의 `stageState`를 공개해도 된다.

현재 `gomoku`의 공개 상태:

```json
{
  "boardSize": 15,
  "board": [[null, "black", null]],
  "currentPlayerId": "p2",
  "turnDeadline": 1779089650000,
  "moveCount": 1,
  "winnerPlayerId": null
}
```

플레이어별 private view는 작다.

```json
{
  "stone": "black"
}
```

이 유형의 게임에서는 다음 원칙을 따르면 된다.

- `stageState`에 권위 있는 판 상태를 둔다.
- `getPublicView()`는 판, 현재 턴, 제한시간, 승자 같은 전역 정보를 그대로 공개한다.
- 플레이어 색상, 좌석, 개인 설정처럼 자기에게만 의미 있는 정보만 `playerStates`에 둔다.
- 착수, 말 이동, 점수 변화 같은 결과는 public event로 방송한다.

오목 액션 예시:

```json
{
  "type": "action",
  "playerId": "p1",
  "clientActionId": "gomoku-1",
  "expectedVersion": 2,
  "action": {
    "type": "placeStone",
    "payload": { "x": 7, "y": 7 }
  }
}
```

서버가 방송하는 public event 예시:

```json
{
  "type": "event",
  "payload": {
    "event": {
      "type": "gomoku.stonePlaced",
      "visibility": "public",
      "payload": {
        "playerId": "p1",
        "x": 7,
        "y": 7,
        "stone": "black"
      }
    }
  }
}
```

클라이언트 구현은 단순하다. `snapshot.payload.publicView.board`를 렌더링하고, `gomoku.stonePlaced` 이벤트가 오면 해당 좌표를 갱신하면 된다.

## 5. Card Demo: 플레이어 상태를 숨겨야 하는 게임

포커, 원카드, 훌라, 보드게임의 비밀 목표처럼 각 플레이어가 감춰진 정보를 갖는 게임은 `stageState`와 `playerStates`를 엄격히 나눠야 한다.

현재 `card-demo`의 public view:

```json
{
  "discardPile": ["AS"],
  "deckCount": 39,
  "currentPlayerId": "p2",
  "round": 1,
  "hands": {
    "p1": { "count": 2 },
    "p2": { "count": 3 }
  }
}
```

현재 플레이어 `p1`의 private view:

```json
{
  "hand": ["7H", "3C"]
}
```

다른 플레이어는 `p1`의 실제 `hand`를 받지 않는다. public view에서는 손패 개수만 볼 수 있다.

이 유형의 게임에서는 다음 원칙을 따르면 된다.

- `stageState`에는 버린 카드 더미, 덱 수, 현재 턴, 라운드처럼 모두가 알아도 되는 정보만 둔다.
- `playerStates[playerId]`에는 손패, 비밀 선택, 숨겨진 점수처럼 해당 플레이어만 알아야 하는 정보를 둔다.
- `getPublicView()`는 private 값을 절대 그대로 반환하지 않는다.
- `getPrivateView()`는 요청한 `playerId`의 개인 상태만 반환한다.
- 카드를 내는 행위처럼 모두가 봐야 하는 결과는 public event로 방송한다.
- 카드를 뽑는 행위처럼 새 카드 값이 본인에게만 보여야 하는 결과는 private event로 보낸다.

카드 제출 액션 예시:

```json
{
  "type": "action",
  "playerId": "p1",
  "clientActionId": "play-as",
  "expectedVersion": 2,
  "action": {
    "type": "playCard",
    "payload": { "card": "AS" }
  }
}
```

서버가 방송하는 public event:

```json
{
  "type": "event",
  "payload": {
    "event": {
      "type": "card.played",
      "visibility": "public",
      "payload": {
        "playerId": "p1",
        "card": "AS"
      }
    }
  }
}
```

카드 뽑기처럼 비공개 결과가 생기는 액션은 `privateEvent`를 사용한다.

```json
{
  "type": "privateEvent",
  "payload": {
    "event": {
      "type": "card.drawn",
      "visibility": "private",
      "playerId": "p1",
      "payload": {
        "card": "D39"
      }
    }
  }
}
```

클라이언트는 public view로 공용 보드를 그리고, 자기 손패 UI는 `snapshot.payload.privateView`와 `privateEvent`만 사용해서 갱신해야 한다.

## 6. 새 게임을 추가하는 방법

새 게임은 `src/games/<game>.ts`에 `GameDefinition`을 추가하고 `src/games/index.ts`에서 등록한다.

최소 구현 항목:

```ts
export const myGameDefinition: GameDefinition = {
  gameId: "my-game",
  adapterKey: "my-game",
  displayName: "My Game",
  minPlayers: 2,
  maxPlayers: 4,
  initialStageState(context) {
    return {};
  },
  initialPlayerState(player, context) {
    return {};
  },
  validateAction(context, action) {
    return { ok: true };
  },
  applyAction(context, action) {
    return { state: context.state, events: [] };
  },
  getPublicView(context) {
    return {};
  },
  getPrivateView(context, playerId) {
    return {};
  },
  nextTimers(context) {
    return [];
  }
};
```

추가 후 `src/games/index.ts`에 등록한다.

```ts
import { myGameDefinition } from "./my-game";
import { registerGame } from "./registry";

registerGame(myGameDefinition);
```

`GET /games`는 등록된 built-in adapter를 D1 `games` 테이블에 seed한다. 따라서 새 adapter를 등록하면 게임 목록에도 나타난다.

## 7. 어댑터 설계 체크리스트

새 게임을 만들 때 먼저 아래 질문에 답해야 한다.

- 모든 플레이어가 같은 전체 상태를 봐도 되는가?
- 각 플레이어에게만 보여야 하는 상태가 있는가?
- 공개 이벤트와 비공개 이벤트를 어떻게 나눌 것인가?
- 액션이 적용되기 전에 확인해야 하는 턴, 자원, 손패, 위치, 타이머 조건은 무엇인가?
- `expectedVersion`이 맞지 않을 때 클라이언트는 snapshot을 다시 받을 것인가?
- 플레이어 재접속 시 private view만으로 개인 UI를 복구할 수 있는가?
- 게임 종료 시 D1 `room_index`와 `match_results`에 어떤 결과를 남겨야 하는가?

상태 배치 기준:

| 정보 | 위치 | 공개 방식 |
| --- | --- | --- |
| 오목판, 현재 턴, 승자 | `stageState` | `getPublicView()`에 포함 |
| 카드게임 버린 더미, 덱 수, 라운드 | `stageState` | `getPublicView()`에 포함 |
| 손패, 비밀 목표, 숨겨진 자원 | `playerStates[playerId]` | `getPrivateView()`에만 포함 |
| 착수, 공개 카드 제출, 승리 선언 | `GameEvent` | `visibility: "public"` 또는 `"system"` |
| 카드 드로우 결과, 개인 보상 | `GameEvent` | `visibility: "private"` + `playerId` |

## 8. 클라이언트 구현 권장 구조

클라이언트는 서버 상태를 다음처럼 분리해서 보관하는 것이 좋다.

```ts
type ClientRoomModel = {
  roomId: string;
  version: number;
  players: Array<{ playerId: string; seat: number; connected: boolean }>;
  publicView: Record<string, unknown>;
  privateView: Record<string, unknown>;
};
```

처리 규칙:

- `snapshot`: 전체 모델을 교체한다.
- `event`: public view에 반영하거나 event log에 추가한다.
- `privateEvent`: 자기 private view에만 반영한다.
- `ack`: optimistic UI를 확정한다.
- `error`가 `stale_action`이면 최신 snapshot을 기다리거나 다시 요청한다.
- `presence`: 접속 상태만 갱신한다.

서버의 `version`은 클라이언트 동기화 기준이다. 액션을 보낼 때 항상 현재 렌더링 기준의 `version`을 `expectedVersion`으로 넣어야 한다.

## 9. 실전 테스트 방법

배포된 서버에서 게임 목록을 확인한다.

```sh
curl https://bighouse.comfuture.workers.dev/games
```

오목은 두 플레이어가 같은 room에 들어간 뒤 `placeStone` 액션을 보내면 된다. 기대 결과는 모든 플레이어가 같은 `gomoku.stonePlaced` public event를 받는 것이다.

카드 게임은 두 플레이어가 같은 room에 들어간 뒤 snapshot을 비교한다. 기대 결과는 다음과 같다.

- `publicView.hands.p1.count`처럼 손패 개수는 보인다.
- `publicView`에는 `"AS"` 같은 실제 손패 값이 없어야 한다.
- `p1`의 `privateView.hand`에는 `["AS", "7H", "3C"]`가 보인다.
- `p1`이 `playCard`로 `"AS"`를 내면 `"AS"`는 public event에 포함된다.

이 차이를 기준으로 새 게임이 공개 상태형인지, 비공개 플레이어 상태형인지 판단하면 된다.
