# CHZZK_CC Stateful Relay (Node.js)

이 Relay는 CHZZK_CC 합방용으로 만든 **상태 유지형 단일 Node.js WebSocket 서버**입니다.

## 핵심 구조

```text
A PC ── local STT ──┐
                    │
B PC ── local STT ──┼──> Stateful Relay ──> A / B / C
                    │
C PC ── local STT ──┘
```

Relay는 음성/오디오를 받지 않습니다. 각 PC에서 만든 `caption` 텍스트 이벤트와 Room 상태만 중계합니다.

## 왜 Vercel 대신 이 서버를 쓰나?

현재 프로토타입은 `rooms = new Map()`으로 Room 상태를 관리합니다. 이 방식은 **하나의 계속 실행되는 Node.js 프로세스**에서는 같은 메모리를 공유하지만, 여러 실행 인스턴스로 분산되면 자동으로 공유되지 않습니다.

따라서 이 버전은 우선 **1개 인스턴스**로 운영해 현재 구조를 최대한 그대로 검증하는 목적입니다.

> 중요: 이 프로토타입은 Room 상태를 메모리에 보관하므로 서버가 재시작되면 Room이 사라집니다. 또한 여러 인스턴스로 확장하면 별도 상태/동기화 계층이 필요합니다.

## 로컬 실행

```bat
npm install
npm start
```

기본 포트는 `10000`이고, `PORT` 환경변수로 변경할 수 있습니다.

Health:

```text
http://localhost:10000/health
```

WebSocket:

```text
ws://localhost:10000/ws
```

## Render 배포

Render Web Service에 이 폴더를 배포합니다.

Build Command:

```text
npm ci
```

Start Command:

```text
npm start
```

서비스는 `PORT` 환경변수를 읽고 `0.0.0.0`에 바인딩합니다.

배포 후 예를 들어 서비스 주소가:

```text
https://chzzk-cc-relay-node.onrender.com
```

이면 CHZZK_CC의 Relay 주소는:

```text
wss://chzzk-cc-relay-node.onrender.com/ws
```

입니다.

## CHZZK_CC 연결 설정

루트 `config.js`에서:

```js
RELAY_WS_URL: process.env.CHZZK_CC_RELAY_WS || 'wss://내-서비스.onrender.com/ws',
```

처럼 실제 주소를 넣습니다.

그 다음 루트 프로젝트의:

```text
build-standalone.bat
```

를 다시 실행합니다.

## 진단 로그

이 서버는 다음 로그를 남깁니다.

```text
[ROOM CREATED]
[JOIN REQUEST]
[JOIN CHECK]
[JOIN FOUND]
[JOIN FAILED]
[CAPTION]
[ROOM DELETE]
```

모든 주요 로그에는 `instanceId`와 `rooms.size`가 포함됩니다.

Health 예시:

```json
{
  "ok": true,
  "service": "CHZZK_CC Stateful Relay",
  "instanceId": "...",
  "rooms": 1,
  "connectedClients": 2,
  "uptime": 123
}
```
