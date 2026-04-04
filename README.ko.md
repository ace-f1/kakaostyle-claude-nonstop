# kakaostyle-claude-nonstop

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)

우선순위 기반 다중 계정 전환, 페일백(failback), Slack 원격 접속을 지원하는 `claude-nonstop` KakaoStyle 포크입니다.

**장애 전환(Failover):** 세션 도중 사용량 제한에 걸리면 다른 계정으로 세션을 이전하고 자동으로 재개합니다.

**선택적 페일백(Failback):** 활성화하면 백그라운드에서 주기적으로 사용량을 확인하고, 우선순위가 높은 계정이 회복되면 유휴 세션을 자동으로 복귀시킵니다.

**Slack 원격 접속:** 각 Claude Code 세션에 전용 Slack 채널이 생성됩니다. 채널에 메시지를 보내면 Claude를 원격으로 제어할 수 있고, Claude의 응답도 채널에 게시됩니다.

![claude-nonstop: Slack 원격 접속과 다중 계정 전환](assets/screenshot.png)

> **플랫폼:** macOS에서만 테스트되었습니다. Linux는 동작할 수 있으나 미검증입니다.

[기여 가이드](CONTRIBUTING.md) | [보안 정책](SECURITY.md) | [아키텍처](DESIGN.md)

## 사용법

```bash
kakaostyle-claude-nonstop                       # Claude 실행 (최적 계정, 자동 전환)
kakaostyle-claude-nonstop -p "버그 수정해줘"    # 단일 프롬프트 실행
kakaostyle-claude-nonstop status                # 모든 계정의 사용량 확인
kakaostyle-claude-nonstop --remote-access       # tmux + Slack 채널과 함께 실행
```

`status` 출력 예시:

```
  default (alice@gmail.com)
    5-hour:  ███░░░░░░░░░░░░░░░░░ 14%
    7-day:   ██████░░░░░░░░░░░░░░ 29%

  work (alice@company.com) <-- best
    5-hour:  █░░░░░░░░░░░░░░░░░░░ 3%
    7-day:   ██░░░░░░░░░░░░░░░░░░ 8%
```

실행 시 모든 계정의 사용량을 확인하여 여유가 가장 많은 계정을 선택합니다. 세션 도중 사용량 제한에 걸리면 다음 최적 계정으로 전환하고 대화를 이어갑니다. 우선순위 기반 페일백은 명시적 옵션으로 활성화할 수 있습니다.

## 우선순위 기반 페일백

이 기능은 기본적으로 비활성화되어 있습니다. `--auto-failback` 옵션으로 명시적으로 활성화하세요.

낮은 숫자일수록 우선순위가 높습니다:

```bash
kakaostyle-claude-nonstop set-priority work 1
kakaostyle-claude-nonstop set-priority personal 2
```

설정 후 동작:

- `work`가 거의 소진 임계값 미만이면 주 계정으로 유지됩니다.
- `work`가 제한에 걸리면 `personal`로 장애 전환됩니다.
- `personal`에서 실행 중일 때 기본 30분 간격으로 사용량을 폴링합니다.
- `work`가 회복되고 Claude 세션이 15초 이상 유휴 상태가 되면 `work`로 세션을 이전합니다.
- 마지막 전환 후 기본 30분의 쿨다운이 지나야 페일백이 발생합니다.

실행 방법:

```bash
kakaostyle-claude-nonstop --auto-failback
```

### 예시: 회사 `Pro` + 개인 `Max` 조합

KakaoStyle 스타일의 일반적인 설정:

```bash
kakaostyle-claude-nonstop add work
kakaostyle-claude-nonstop add personal
kakaostyle-claude-nonstop set-priority work 1
kakaostyle-claude-nonstop set-priority personal 2
```

예상 런타임 동작:

- 회사 `Pro` 계정에 여유가 있으면 `work`로 시작합니다.
- `work`가 사용량 제한에 걸리면 `personal`로 장애 전환하고 동일 세션을 재개합니다.
- 회사 `Pro` 제한 초기화 시간 동안 `personal`에서 계속 실행합니다.
- `work`가 정상 상태로 돌아오면 `personal`에서 `work`로 자동 페일백합니다.
- 페일백 전환에 추가 스왑 횟수를 소모하지 않습니다.

CLI 옵션:

- `--auto-failback`: 능동적 페일백 활성화
- `--no-auto-failback`: 페일백 강제 비활성화
- `--failback-poll-ms <n>`: 폴링 간격, 기본값 `1800000` (30분)
- `--failback-idle-ms <n>`: 페일백 전 유휴 시간, 기본값 `15000` (15초)
- `--failback-cooldown-ms <n>`: 전환 후 쿨다운, 기본값 `1800000` (30분)

환경변수:

- `CLAUDE_NONSTOP_AUTO_FAILBACK=1`: 기본적으로 능동적 페일백 활성화
- `CLAUDE_NONSTOP_FAILBACK_POLL_MS`: 회복 확인 폴링 간격, 기본값 `1800000`
- `CLAUDE_NONSTOP_FAILBACK_IDLE_MS`: 페일백 전 필요한 유휴 시간, 기본값 `15000`
- `CLAUDE_NONSTOP_FAILBACK_COOLDOWN_MS`: 전환 후 최소 대기 시간, 기본값 `1800000`
- `CLAUDE_NONSTOP_DISABLE_FAILBACK=1`: 능동적 페일백 비활성화

### 수동 검증

권장 수동 테스트 흐름:

1. 두 계정을 등록하고 우선순위를 설정합니다:
   `work=1`, `personal=2`
2. 보수적인 운영 기본값으로 실행합니다:

```bash
kakaostyle-claude-nonstop \
  --auto-failback \
  --failback-poll-ms 1800000 \
  --failback-idle-ms 15000 \
  --failback-cooldown-ms 1800000
```

3. `work -> personal` 장애 전환을 유발하거나 기다립니다.
4. 동일한 `--resume` 세션으로 `personal`에서 세션이 재개되는지 확인합니다.
5. `work` 사용량이 회복될 때까지 기다립니다.
6. 러너가 페일백을 로그로 기록하고 세션을 `work`로 이전하는지 확인합니다.

예상 로그 형태:

- `Selected "work" (...)`
- `Rate limit detected on "work" (...)`
- `Switching to "personal" (...)`
- `Session <id> migrated successfully`
- `Higher-priority account recovered while "personal" was active. Failing back...`
- `Failing back to "work" (...)`
- `Session <id> migrated successfully`

## 명령어

**기본:**

| 명령어 | 설명 |
|--------|------|
| `status` | 진행 바와 초기화 시간을 포함한 사용량 표시 |
| `add <name>` | 새 Claude 계정 추가 (OAuth를 위해 브라우저 열림) |
| `remove <name>` | 계정 제거 |
| `list` | 인증 상태와 함께 계정 목록 표시 |
| `reauth` | 만료된 계정 재인증 |
| `resume [id]` | 가장 최근 세션 또는 특정 ID의 세션 재개 |

**Slack 원격 접속:**

| 명령어 | 설명 |
|--------|------|
| `setup` | Slack 토큰 설정 및 훅 설치 (`setup --help`로 플래그 확인) |
| `webhook status` | 웹훅 서비스 상태 표시 |
| `webhook install` | 웹훅을 launchd 서비스로 설치 (macOS) |
| `webhook logs` | 웹훅 로그 추적 |
| `hooks install` | 모든 프로필에 훅 설치 |
| `hooks status` | 훅 설치 상태 표시 |

**유지관리:**

| 명령어 | 설명 |
|--------|------|
| `update` | 로컬 소스에서 재설치 |
| `uninstall` | `kakaostyle-claude-nonstop` 완전 제거 |

인식되지 않는 인수는 `claude`에 직접 전달됩니다. `-a <name>`으로 특정 계정을 선택할 수 있습니다.

## 설치

가장 쉬운 방법은 Claude Code에게 요청하는 것입니다:

```
나: kakaostyle-claude-nonstop 설정해줘
```

Claude Code가 [CLAUDE.md](CLAUDE.md)의 설정 지침에 따라 설치, 계정 설정, Slack 원격 접속 설정을 대화형으로 진행합니다. 이 파일은 AI 에이전트가 설정을 자동화할 때의 참고 문서이기도 합니다.

### 수동 설치

**전제 조건:** Node.js 22+ ([다운로드](https://nodejs.org/)), C/C++ 빌드 도구 (macOS에서 `xcode-select --install`), Claude Code CLI ([설치](https://docs.anthropic.com/en/docs/claude-code/overview)), 원격 접속용 tmux

```bash
git clone https://github.com/ace-f1/kakaostyle-claude-nonstop.git
cd kakaostyle-claude-nonstop
npm install -g "$(npm pack)"
kakaostyle-claude-nonstop help
```

`npm install -g`가 컴파일 오류로 실패하면 C/C++ 빌드 도구가 없는 것입니다.

## 다중 계정 설정

기존 `~/.claude` 계정은 "default"로 자동 감지됩니다. `kakaostyle-claude-nonstop list`로 확인하세요.

추가 계정을 등록합니다 (각각 다른 Claude 구독이어야 합니다). 이름은 영문자, 숫자, 하이픈, 언더스코어만 사용 가능합니다:

```bash
kakaostyle-claude-nonstop add work
kakaostyle-claude-nonstop add personal
```

`add` 명령은 OAuth를 위해 브라우저를 엽니다. 로그인 후 `kakaostyle-claude-nonstop`이 중복 계정(동일 이메일)을 자동으로 감지하고 제거합니다.

모든 계정이 정상 동작하는지 확인합니다:

```bash
kakaostyle-claude-nonstop status
```

이후 `kakaostyle-claude-nonstop`만 실행하면 사용량 제한 전환이 자동으로 이루어집니다.

**문제 해결:**
- OAuth가 완료되지 않았나요? `kakaostyle-claude-nonstop reauth` 실행
- 상태에 `error (HTTP 401)` 표시? `kakaostyle-claude-nonstop reauth` 실행
- "No credentials found" 오류? `CLAUDE_CONFIG_DIR="$HOME/.claude-nonstop/profiles/<name>" claude auth login` 실행

**선택적 별칭** (`~/.zshrc` 또는 `~/.bashrc`):

```bash
alias claude='kakaostyle-claude-nonstop'
alias cn='kakaostyle-claude-nonstop --dangerously-skip-permissions'
```

## Slack 원격 접속

### 1. Slack 앱 생성

[api.slack.com/apps](https://api.slack.com/apps) > **Create New App** > **From a manifest**으로 이동합니다. [`slack-manifest.yaml`](slack-manifest.yaml) 내용을 붙여넣고 **Create**를 클릭한 후 **Install to Workspace**를 클릭합니다.

<details>
<summary>수동 설정 (매니페스트 없이)</summary>

[api.slack.com/apps](https://api.slack.com/apps)에서 새 앱을 생성합니다. Socket Mode를 활성화합니다 (Settings > Socket Mode). 봇 토큰 스코프를 추가합니다: `chat:write`, `channels:manage`, `channels:history`, `channels:read`, `reactions:read`, `reactions:write`, `app_mentions:read`, `im:history`, `im:read`, `im:write`. 봇 이벤트를 구독합니다: `message.channels`, `message.im`, `app_mention`. 워크스페이스에 설치합니다.
</details>

**두 가지 토큰을 수집합니다:**

1. **Bot Token** (`xoxb-...`) — OAuth & Permissions 페이지 (설치 시 생성)
2. **App Token** (`xapp-...`) — Basic Information > App-Level Tokens > **Generate Token and Scopes** > `connections:write` 스코프 추가 > Generate

### 2. setup 실행

```bash
kakaostyle-claude-nonstop setup --bot-token xoxb-... --app-token xapp-... --invite-user-id U12345ABCDE
```

`~/.claude-nonstop/.env` 파일을 작성하고, 훅을 설치하며, 웹훅 서비스를 시작합니다 (macOS). 전체 플래그는 `setup --help`를 참고하세요. 대화형 설정은 `kakaostyle-claude-nonstop setup`을 실행하세요.

Slack User ID 확인 방법: 프로필 사진 클릭 > Profile > 점 세 개 메뉴 > Copy member ID

### 3. 검증

```bash
kakaostyle-claude-nonstop webhook status    # "running"과 PID가 표시되어야 함
kakaostyle-claude-nonstop hooks status      # 모두 "installed"가 표시되어야 함
```

### 4. 원격 접속으로 실행

```bash
kakaostyle-claude-nonstop --remote-access
```

현재 디렉토리 이름으로 tmux 세션을 생성하고, 무인 운영을 위해 `--dangerously-skip-permissions`를 활성화하며, `CLAUDE_REMOTE_ACCESS=true`를 설정하여 각 세션에 전용 Slack 채널(예: `#cn-myproject-abc12345`)을 만듭니다. 채널에서 답장하면 Claude에게 메시지가 전달됩니다.

**세션 채널 제어 명령어:**

| 명령어 | 동작 |
|--------|------|
| `!stop` | Claude 중단 (Ctrl+C) |
| `!status` | 현재 터미널 출력 캡처 및 게시 |
| `!cmd <text>` | 텍스트 그대로 전달 (예: `!cmd /clear`) |
| `!help` | 사용 가능한 명령어 목록 표시 |
| `!archive` | 채널 아카이브 |

**참고:** Slack 메시지 릴레이는 tmux에 키 입력을 전송합니다. Claude가 입력을 기다리는 상태여야 메시지를 받을 수 있습니다. Claude가 처리 중일 때 키 입력은 대기열에 쌓이고 Claude가 다음에 입력을 기다릴 때 전달됩니다.

**보안:** `--remote-access`는 `--dangerously-skip-permissions`를 포함하여 Claude에게 시스템 전체 접근 권한을 부여합니다. `SLACK_ALLOWED_USERS`로 Slack을 통해 명령을 보낼 수 있는 사용자를 제한하세요.

**문제 해결:**
- 채널이 생성되지 않나요? `kakaostyle-claude-nonstop hooks install` 후 `hooks status` 확인
- 웹훅이 수신하지 못하나요? `kakaostyle-claude-nonstop webhook status` 후 `webhook logs` 확인
- 메시지가 Claude에게 전달되지 않나요? `tmux ls`를 확인하고 Claude가 입력을 기다리는지 확인

## 동작 원리

**다중 계정 전환:** 모든 계정의 Anthropic 사용량 API를 조회하여 (~200ms) 여유가 가장 많은 계정을 선택하고, Claude 출력에서 사용량 제한 메시지를 실시간으로 감지합니다. 감지 시: 종료, 다음 계정으로 세션 파일 이전, `claude --resume`으로 재개합니다.

**Slack 원격 접속:** Claude Code [훅](https://docs.anthropic.com/en/docs/claude-code/hooks)을 사용합니다. `SessionStart`에서 Slack 채널을 생성하고, `Stop`에서 완료 요약을 게시합니다. 별도의 웹훅 프로세스가 Slack Socket Mode로 연결하여 채널 메시지를 tmux로 릴레이합니다. 러너는 PTY 출력에서 도구 활동을 스크래핑하여 약 10초마다 Slack에 진행 상황 업데이트를 게시합니다.

## 아키텍처

```
kakaostyle-claude-nonstop/
├── bin/claude-nonstop.js         CLI 진입점 및 명령어 라우팅
├── lib/                          핵심 로직 (ESM)
│   ├── config.js                 계정 레지스트리
│   ├── keychain.js               OS 자격증명 저장소 읽기
│   ├── usage.js                  Anthropic 사용량 API 클라이언트
│   ├── scorer.js                 최적 계정 선택 알고리즘
│   ├── session.js                세션 파일 이전
│   ├── runner.js                 프로세스 래퍼 + 사용량 제한 감지
│   ├── service.js                launchd 서비스 관리 (macOS)
│   ├── tmux.js                   tmux 세션 관리
│   ├── reauth.js                 재인증 플로우
│   └── platform.js               OS 감지
├── remote/                       Slack 원격 접속 서브시스템 (CJS)
│   ├── hook-notify.cjs           훅 진입점
│   ├── channel-manager.cjs       Slack 채널 생명주기
│   ├── webhook.cjs               Socket Mode 핸들러 (Slack -> tmux)
│   ├── start-webhook.cjs         웹훅 프로세스 진입점
│   ├── load-env.cjs              환경 파일 로더
│   └── paths.cjs                 공유 경로 상수
└── scripts/postinstall.js        npm 설치 시 웹훅 재시작
```

사용자 데이터는 `~/.claude-nonstop/` 하위에 저장됩니다 (설정, `.env`, 프로필, 로그). 자세한 내용은 [DESIGN.md](DESIGN.md)를 참고하세요.

## 문제 해결

### `npm install` 컴파일 오류로 실패

`node-pty`는 C/C++ 빌드 도구가 필요합니다: `xcode-select --install` (macOS) 실행 후 `npm install`을 다시 실행하세요.

### 사용량에 "error (HTTP 401)" 표시

OAuth 토큰이 만료되었습니다. `kakaostyle-claude-nonstop reauth`를 실행하여 만료된 계정을 갱신하세요.

### 웹훅이 메시지를 수신하지 못함

`kakaostyle-claude-nonstop webhook status`와 `webhook logs`를 확인하세요. Slack 앱 설정에서 Socket Mode가 활성화되어 있고 봇 이벤트(`message.channels`, `message.im`)가 구독되어 있는지 확인하세요.

### 메시지가 Claude에게 전달되지 않음

Claude가 입력을 기다리는 상태여야 합니다. `tmux ls`와 `~/.claude-nonstop/data/channel-map.json`을 확인하세요.

## 플랫폼 지원

| 플랫폼 | 자격증명 저장소 | 서비스 관리 | 상태 |
|--------|----------------|------------|------|
| macOS | Keychain (`security`) | launchd | 테스트됨 |
| Linux | Secret Service (`secret-tool`) | 수동 (systemd) | 미테스트 |
| Windows | — | — | 미지원 |

## 라이선스

[MIT](LICENSE)
