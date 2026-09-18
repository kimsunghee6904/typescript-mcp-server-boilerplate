import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
    title: 'TypeScript MCP Server',
    description: 'Vercel에 배포 가능한 Streamable HTTP MCP 서버'
}

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="ko">
            <body style={{ margin: 0, background: '#f7f7f5', color: '#171717' }}>{children}</body>
        </html>
    )
}
