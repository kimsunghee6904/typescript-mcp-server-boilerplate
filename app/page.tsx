export default function HomePage() {
    return (
        <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '4rem auto', padding: '0 1.5rem', lineHeight: 1.6 }}>
            <h1>TypeScript MCP Server</h1>
            <p>
                이 앱은 Streamable HTTP로 MCP 도구를 제공합니다. Cursor 같은 MCP 클라이언트를
                아래 엔드포인트에 연결하세요.
            </p>
            <pre
                style={{
                    background: '#111',
                    color: '#f5f5f5',
                    padding: '1rem',
                    borderRadius: 8,
                    overflowX: 'auto'
                }}
            >
                /api/mcp
            </pre>
            <p>
                이미지 생성 도구는 클라이언트 요청의 <code>x-hf-token</code> 헤더, 또는 서버의{' '}
                <code>HF_TOKEN</code> 환경변수로 HuggingFace 토큰을 받습니다.
            </p>
        </main>
    )
}
