import { createMcpHandler } from 'mcp-handler'
import type { NextRequest } from 'next/server'
import { registerMcpCapabilities } from '@/lib/mcp/register'

export const runtime = 'nodejs'
export const maxDuration = 60

const handler = async (req: NextRequest) => {
    const hfToken = req.headers.get('x-hf-token')?.trim() || process.env.HF_TOKEN

    return createMcpHandler(
        (server) => {
            registerMcpCapabilities(server, { hfToken })
        },
        {
            serverInfo: {
                name: 'typescript-mcp-server',
                version: '1.0.0'
            }
        }
    )(req)
}

export { handler as GET, handler as POST }
