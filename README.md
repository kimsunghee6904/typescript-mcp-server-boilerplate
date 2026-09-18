# TypeScript MCP Server 보일러플레이트

TypeScript MCP SDK와 Next.js를 활용해 Streamable HTTP MCP 서버를 Vercel에 배포할 수 있는 보일러플레이트입니다.

## 프로젝트 구조

```
typescript-mcp-server-boilerplate/
├── app/
│   ├── api/mcp/route.ts   # Streamable HTTP MCP 엔드포인트
│   ├── layout.tsx
│   └── page.tsx           # 엔드포인트 안내 페이지
├── lib/mcp/
│   └── register.ts        # 도구·리소스 등록
├── next.config.ts
├── package.json
└── README.md
```

## 시작하기

### 1. 의존성 설치

```bash
npm install
```

### 2. 개발 서버 실행

```bash
npm run dev
```

MCP 엔드포인트는 `http://localhost:3000/api/mcp` 입니다.

### 3. HuggingFace 토큰 (이미지 생성)

`generate-image` 도구는 HuggingFace 토큰이 필요합니다. 우선순위는 다음과 같습니다.

1. 클라이언트 요청의 `x-hf-token` 헤더
2. 서버 환경변수 `HF_TOKEN` (로컬 `.env` 또는 Vercel Environment Variables)

```bash
cp .env.example .env
```

`.env`에 `HF_TOKEN=` 값을 넣은 뒤, Cursor MCP 설정에서도 헤더로 전달할 수 있습니다.

## Cursor MCP 연결

`.cursor/mcp.json` 예시:

```json
{
    "mcpServers": {
        "typescript-mcp-server": {
            "url": "http://localhost:3000/api/mcp",
            "headers": {
                "x-hf-token": "${env:HF_TOKEN}"
            }
        }
    }
}
```

배포 후에는 `url`을 `https://<project>.vercel.app/api/mcp`로 바꾸면 됩니다.

이 파일은 gitignore되어 있으므로 로컬 토큰을 넣어도 커밋되지 않습니다. 가능하면 `${env:HF_TOKEN}`처럼 환경변수 보간을 사용하세요.

### 테스트 명령어

- "5 더하기 3은 얼마야?" (계산기)
- "안녕하세요 라고 인사해줘" (인사)
- 서버 정보 리소스 조회
- HuggingFace 토큰이 있으면 이미지 생성

## Vercel 배포

1. 이 저장소를 Vercel에 연결합니다.
2. Node.js 20 이상을 사용하고, Fluid compute를 켜 두는 것을 권장합니다.
3. 서버 측 폴백이 필요하면 Project Settings에서 `HF_TOKEN` 환경변수를 추가합니다. 클라이언트 `x-hf-token` 헤더가 있으면 그 값이 우선합니다.

배포 후 MCP 호스트에는 아래 URL을 등록합니다.

```
https://<project>.vercel.app/api/mcp
```

로컬 검증은 MCP Inspector에서 Transport를 Streamable HTTP로 두고 `http://localhost:3000/api/mcp`에 연결하면 됩니다.

## 포함된 도구

| 도구 | 설명 |
| --- | --- |
| `greet` | 이름과 언어를 받아 인사말을 반환합니다. |
| `geocode` | 도시명/주소를 위도·경도로 변환합니다. |
| `get-weather` | 좌표로 현재 날씨와 단기 예보를 조회합니다. |
| `calculator` | 두 숫자와 연산자로 사칙연산 결과를 반환합니다. |
| `generate-image` | HuggingFace FLUX.1-schnell로 이미지를 생성합니다. |

리소스 `config://server-info`는 서버 구성 정보를 JSON으로 반환합니다.

## 스크립트

- `npm run dev`: Next.js 개발 서버
- `npm run build`: 프로덕션 빌드
- `npm run start`: 빌드 결과 실행

## 참고 자료

- [Deploy MCP servers to Vercel](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel)
- [mcp-handler](https://github.com/vercel/mcp-handler)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Zod](https://zod.dev/)

## 라이선스

MIT
