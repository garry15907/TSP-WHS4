# Tiny Second-hand Shopping Platform

시큐어 코딩 과제를 위한 소형 중고거래 플랫폼입니다. 회원가입, 로그인, 상품 등록/조회/검색, 전역 채팅, 1:1 채팅, 사용자 간 송금, 신고/자동 차단, 관리자 대시보드를 포함합니다.

## 기술 스택

- Node.js 24
- Express + EJS
- Socket.IO
- `node:sqlite` 내장 SQLite
- `express-session`, `helmet`, `express-rate-limit`, `csrf-sync`, `zod`, `bcryptjs`

## 주요 보안 포인트

- 비밀번호 해시 저장: `bcryptjs`
- 세션 기반 인증, `httpOnly` 쿠키 사용
- CSRF 토큰 검증
- 인증/일반 요청 rate limit
- Zod 기반 서버측 입력 검증
- SQL 인젝션 방지: prepared statement 사용
- 기본 XSS 방어: 서버 렌더링 시 EJS escape 사용
- 신고 임계치 기반 자동 차단/휴면 전환
- 파일 업로드 제외: 이미지 URL만 허용해 업로드 취약점 범위 축소

## 실행 방법

1. `.env.example`을 참고해 `.env`를 생성합니다.
2. 의존성을 설치합니다.

```bash
npm install
```

3. 개발 서버를 실행합니다.

```bash
npm start
```

4. 브라우저에서 `http://localhost:3000`으로 접속합니다.

## 기본 관리자 계정

- 아이디: `.env`의 `ADMIN_USERNAME`
- 비밀번호: `.env`의 `ADMIN_PASSWORD`

처음 실행 시 계정이 자동 생성됩니다.

## 테스트

```bash
npm test
```

## 보고서 생성

```bash
npm run report:build
```

생성 파일:

- `docs/artifacts/tiny-secondhand-platform-report.docx`
- `docs/artifacts/tiny-secondhand-platform-report.pdf`

한컴오피스가 설치된 Windows 환경에서는 HWP도 생성할 수 있습니다.

```powershell
npm run report:build:hwp
```

생성 파일:

- `docs/artifacts/tiny-secondhand-platform-report.hwp`
- `docs/artifacts/[WHS][secure-coding][03반]서승린(9585).hwp`

## 폴더 구조

```text
src/            서버 코드
views/          EJS 템플릿
public/         정적 자산
docs/           과제 보고서 및 체크리스트
test/           자동 테스트
```

## 과제 문서

- [개발 보고서](docs/report.md)
- [테스트 체크리스트](docs/checklist.md)
