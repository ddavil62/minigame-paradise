# 자동 콘텐츠 파이프라인

기본 제작 방식은 별도 종량제 API가 아니라 Codex의 내장 `imagegen`이다. 하루 생성량이 제한되더라도 이 게임의 개인적인 사용 규모에는 충분하며, 별도 `OPENAI_API_KEY`나 API 과금이 필요 없다.

전체 흐름은 `브리프 준비 → Codex 내장 이미지 생성 → 이미지 A 기반 B 편집 → Codex 시각 검수 → 로컬 규칙 검증 → 자동 게시`다. 사람은 사전 승인자가 아니라 실제 플레이 중 품질이 나쁜 스테이지를 사후 신고하는 역할을 맡는다.

## 구독형 기본 흐름

먼저 브리프를 후보 작업으로 만든다.

```powershell
npm run content:prepare -- --brief content/briefs/moonlit-greenhouse.json
```

후보 폴더에는 다음 파일이 만들어진다.

- `candidate.json`: 스테이지 메타데이터와 현재 상태
- `prompt-a.txt`: 원본 이미지 생성 프롬프트
- `prompt-b.txt`: A를 기준으로 차이 그림을 만드는 편집 프롬프트

브리프의 `collectionId`는 `moonlight-mystery`, `world-adventure`, `seasonal-stories`, `style-lab`, `japanese-comics`, `wonder-park` 중 하나를 사용한다. `stageType`은 75초·힌트 1회의 `speed`, 기본 규칙의 `classic`, 120초·힌트 3회의 `relaxed` 중 하나다. 선택 화면은 이 두 값을 기준으로 테마 챕터와 플레이 유형을 표시한다.

이후 Codex에게 “준비된 브리프로 스테이지를 생성해서 게시해줘”라고 요청한다. Codex가 내장 `imagegen`으로 `image-a.png`를 생성하고, 그 이미지를 편집 대상으로 `image-b.png`를 만든다. 결과를 직접 비교해 차이점 좌표 JSON을 작성한 뒤 다음 검증·게시 명령을 실행한다.

```powershell
npm run content:finalize -- moonlit-greenhouse-01 --differences content/candidates/moonlit-greenhouse-01/differences.json --publish
```

승인되면 이미지가 `assets/puzzles/`로 복사되고 `content/published/stages.json`에 추가된다. 이미지 파일·좌표에 문제가 있으면 게시하지 않고 `retry` 또는 `reject` 상태와 이유를 남긴다.

## 운영 명령

- `content:list`: 게시물과 후보 상태 조회
- `content:prepare -- --brief <file>`: 구독형 imagegen 작업 준비
- `content:finalize -- <id> --differences <file> [--publish]`: 시각 검수 결과 검증 및 게시
- `content:review -- <id>`: API 없이 로컬 파일·좌표 재검증
- `content:publish -- <id>`: 이미 승인된 후보 게시

## 선택적 종량제 API 모드

완전 무인 대량 생성이 필요할 때만 기존 API 모드를 선택적으로 사용할 수 있다. 이 경로는 `OPENAI_API_KEY`와 별도 API 비용이 발생한다.

- `content:api:generate -- --brief <file>`
- `content:api:review -- <id>`
- `content:api:run -- --brief <file> --max-attempts 3`

## 검증 기준

검수는 목표 개수의 명확한 국소 차이, 좌우 구도와 화풍의 일치, 오발생 차이·문자·워터마크·깨진 형태의 부재를 확인한다. 로컬 검증기는 경로 이탈, 누락 파일, 이미지 크기 불일치, 동일 이미지, 잘못된 좌표를 추가로 차단한다.
