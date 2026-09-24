# CHZZK_CC 외부 Relay 프로토타입

이 폴더는 기존 CHZZK_CC의 **개인 로컬 서버는 그대로 유지**하면서, 합방 Room과 자막 텍스트만 외부에서 연결하기 위한 Vercel 프로토타입입니다.

## 구조

스트리머 A 로컬 서버 → Vercel Relay → 스트리머 B 로컬 서버

- 음성/오디오: 외부 서버로 보내지 않음
- STT: 각 PC에서 처리
- OBS: 각 PC의 localhost 사용
- 외부 Relay: Room / 참가자 / 자막 이벤트 중계

## 현재 프로토타입의 한계

Room 상태는 Relay 인스턴스 메모리에만 있습니다. Vercel이 인스턴스를 교체하거나 여러 인스턴스로 분산하면 Room이 공유되지 않을 수 있습니다.

따라서 **지금 단계는 2~3명 테스트용 프로토타입**입니다. 실제 서비스 단계에서는 Durable한 상태/동기화 계층을 추가해야 합니다.

## 배포 후 주소

Vercel 프로젝트 주소가 예를 들어:

`https://chzzk-cc-relay.vercel.app`

이면 CHZZK_CC의 Relay 주소는:

`wss://chzzk-cc-relay.vercel.app/api/ws`

입니다.
