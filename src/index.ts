import { InferenceClient } from '@huggingface/inference'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const GEOCODING_API_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_API_URL = 'https://api.open-meteo.com/v1/forecast'
const USER_AGENT = 'typescript-mcp-server/1.0'

type GeocodeResult = {
    id: number
    name: string
    latitude: number
    longitude: number
    elevation?: number
    timezone?: string
    country?: string
    country_code?: string
    admin1?: string
    admin2?: string
    admin3?: string
    population?: number
    feature_code?: string
}

const HANGUL_RE = /[\uAC00-\uD7A3]/
const KOREAN_ADMIN_SUFFIX_RE = /(광역시|특별자치시|특별자치도|특별시|자치시|자치도|시|군|구|도)$/

const KOREAN_QUERY_ALIASES: Record<string, string[]> = {
    서울: ['서울특별시', 'Seoul'],
    부산: ['부산광역시', 'Busan'],
    인천: ['인천광역시', 'Incheon'],
    대구: ['대구광역시', 'Daegu'],
    대전: ['대전광역시', 'Daejeon'],
    광주: ['광주광역시', 'Gwangju'],
    울산: ['울산광역시', 'Ulsan'],
    세종: ['세종시', 'Sejong'],
    제주: ['제주시', 'Jeju']
}

const FEATURE_RANK: Record<string, number> = {
    PPLC: 100,
    PPLA: 90,
    PPLA2: 70,
    PPLA3: 60,
    PPLA4: 50,
    PPL: 40
}

type GeocodeResponse = {
    results?: GeocodeResult[]
}

type ForecastResponse = {
    latitude: number
    longitude: number
    timezone?: string
    current_units?: Record<string, string>
    current?: {
        time: string
        temperature_2m: number
        relative_humidity_2m: number
        apparent_temperature: number
        precipitation: number
        weather_code: number
        cloud_cover: number
        wind_speed_10m: number
        wind_direction_10m: number
        is_day: number
    }
    daily_units?: Record<string, string>
    daily?: {
        time: string[]
        weather_code: number[]
        temperature_2m_max: number[]
        temperature_2m_min: number[]
        precipitation_sum: number[]
        precipitation_probability_max: number[]
    }
}

const WMO_WEATHER_KO: Record<number, string> = {
    0: '맑음',
    1: '대체로 맑음',
    2: '부분적으로 흐림',
    3: '흐림',
    45: '안개',
    48: '착빙 안개',
    51: '가벼운 이슬비',
    53: '보통 이슬비',
    55: '짙은 이슬비',
    56: '가벼운 어는 이슬비',
    57: '짙은 어는 이슬비',
    61: '약한 비',
    63: '보통 비',
    65: '강한 비',
    66: '약한 어는 비',
    67: '강한 어는 비',
    71: '약한 눈',
    73: '보통 눈',
    75: '강한 눈',
    77: '진눈깨비',
    80: '약한 소나기',
    81: '보통 소나기',
    82: '강한 소나기',
    85: '약한 눈소나기',
    86: '강한 눈소나기',
    95: '뇌우',
    96: '약한 우박을 동반한 뇌우',
    99: '강한 우박을 동반한 뇌우'
}

function describeWeather(code: number): string {
    return WMO_WEATHER_KO[code] ?? `알 수 없는 날씨 (코드 ${code})`
}

function cardinalDirection(degree: number): string {
    const directions = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
    const index = Math.round(degree / 45) % 8
    return directions[index] ?? '북'
}

const CALCULATOR_OPERATORS = ['+', '-', '*', '/'] as const
type CalculatorOperator = (typeof CALCULATOR_OPERATORS)[number]

function calculate(a: number, b: number, operator: CalculatorOperator): number {
    switch (operator) {
        case '+':
            return a + b
        case '-':
            return a - b
        case '*':
            return a * b
        case '/':
            if (b === 0) {
                throw new Error('0으로 나눌 수 없습니다.')
            }
            return a / b
    }
}

function textResult(text: string, structuredContent: Record<string, unknown>, isError = false) {
    return {
        content: [
            {
                type: 'text' as const,
                text
            }
        ],
        structuredContent,
        ...(isError ? { isError: true } : {})
    }
}

async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT }
    })

    if (!response.ok) {
        throw new Error(`API 요청 실패 (${response.status} ${response.statusText})`)
    }

    return (await response.json()) as T
}

function buildGeocodeQueries(query: string): string[] {
    const trimmed = query.trim()
    const queries = [trimmed, ...(KOREAN_QUERY_ALIASES[trimmed] ?? [])]

    if (HANGUL_RE.test(trimmed) && !KOREAN_ADMIN_SUFFIX_RE.test(trimmed)) {
        queries.push(
            `${trimmed}시`,
            `${trimmed}광역시`,
            `${trimmed}특별시`,
            `${trimmed}특별자치시`,
            `${trimmed}특별자치도`
        )
    }

    return [...new Set(queries)]
}

function rankGeocodeResult(result: GeocodeResult): number {
    return (result.population ?? 0) * 10 + (FEATURE_RANK[result.feature_code ?? ''] ?? 10)
}

async function searchLocations(
    query: string,
    count: number,
    language: string
): Promise<GeocodeResult[]> {
    const queries = buildGeocodeQueries(query)
    const responses = await Promise.all(
        queries.map((name) => {
            const url = new URL(GEOCODING_API_URL)
            url.searchParams.set('name', name)
            url.searchParams.set('count', String(Math.max(count, 5)))
            url.searchParams.set('language', language)
            url.searchParams.set('format', 'json')
            return fetchJson<GeocodeResponse>(url.toString())
        })
    )

    const byId = new Map<number, GeocodeResult>()
    for (const response of responses) {
        for (const result of response.results ?? []) {
            if (!byId.has(result.id)) {
                byId.set(result.id, result)
            }
        }
    }

    return [...byId.values()]
        .sort((a, b) => rankGeocodeResult(b) - rankGeocodeResult(a))
        .slice(0, count)
}

// Create server instance
const server = new McpServer({
    name: 'typescript-mcp-server',
    version: '1.0.0'
})

server.registerTool(
    'greet',
    {
        description: '이름과 언어를 입력하면 인사말을 반환합니다.',
        inputSchema: z.object({
            name: z.string().describe('인사할 사람의 이름'),
            language: z
                .enum(['ko', 'en'])
                .optional()
                .default('en')
                .describe('인사 언어 (기본값: en)')
        }),
        outputSchema: z.object({
            content: z
                .array(
                    z.object({
                        type: z.literal('text'),
                        text: z.string().describe('인사말')
                    })
                )
                .describe('인사말')
        })
    },
    async ({ name, language }) => {
        const greeting =
            language === 'ko'
                ? `안녕하세요, ${name}님!`
                : `Hey there, ${name}! 👋 Nice to meet you!`

        return {
            content: [
                {
                    type: 'text' as const,
                    text: greeting
                }
            ],
            structuredContent: {
                content: [
                    {
                        type: 'text' as const,
                        text: greeting
                    }
                ]
            }
        }
    }
)

server.registerTool(
    'geocode',
    {
        description:
            '도시명이나 주소를 입력하면 Open-Meteo Geocoding API로 위도/경도 좌표를 조회합니다. 한글(부산, 서울)과 영어 모두 사용할 수 있습니다.',
        inputSchema: z.object({
            query: z
                .string()
                .min(1)
                .describe('검색할 도시명 또는 주소 (예: 서울, Seoul, Paris, France)'),
            count: z
                .number()
                .int()
                .min(1)
                .max(10)
                .optional()
                .default(5)
                .describe('반환할 최대 결과 수 (기본값: 5)'),
            language: z
                .enum(['ko', 'en'])
                .optional()
                .default('ko')
                .describe('결과 언어 (기본값: ko)')
        }),
        outputSchema: z.object({
            locations: z
                .array(
                    z.object({
                        name: z.string(),
                        latitude: z.number(),
                        longitude: z.number(),
                        country: z.string().optional(),
                        countryCode: z.string().optional(),
                        admin1: z.string().optional(),
                        admin2: z.string().optional(),
                        timezone: z.string().optional(),
                        elevation: z.number().optional(),
                        population: z.number().optional(),
                        featureCode: z.string().optional()
                    })
                )
                .describe('검색된 위치 목록')
        })
    },
    async ({ query, count, language }) => {
        try {
            const results = await searchLocations(query, count, language)
            const locations = results.map((item) => ({
                name: item.name,
                latitude: item.latitude,
                longitude: item.longitude,
                country: item.country,
                countryCode: item.country_code,
                admin1: item.admin1,
                admin2: item.admin2,
                timezone: item.timezone,
                elevation: item.elevation,
                population: item.population,
                featureCode: item.feature_code
            }))

            if (locations.length === 0) {
                return textResult(
                    `"${query}"에 해당하는 위치를 찾지 못했습니다.`,
                    { locations: [] }
                )
            }

            const summary = locations
                .map((location, index) => {
                    const region = [location.admin1, location.country]
                        .filter(Boolean)
                        .join(', ')
                    return `${index + 1}. ${location.name}${region ? ` (${region})` : ''} — 위도 ${location.latitude}, 경도 ${location.longitude}`
                })
                .join('\n')

            return textResult(
                `"${query}" 검색 결과 ${locations.length}건:\n${summary}`,
                { locations }
            )
        } catch (error) {
            const message =
                error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
            return textResult(`지오코딩 조회 실패: ${message}`, { locations: [] }, true)
        }
    }
)

server.registerTool(
    'calculator',
    {
        description:
            '두 숫자와 연산자(+, -, *, /)를 입력받아 계산 결과를 반환합니다.',
        inputSchema: z.object({
            a: z.number().describe('첫 번째 숫자'),
            b: z.number().describe('두 번째 숫자'),
            operator: z
                .enum(CALCULATOR_OPERATORS)
                .describe('연산자: + (덧셈), - (뺄셈), * (곱셈), / (나눗셈)')
        }),
        outputSchema: z.object({
            a: z.number(),
            b: z.number(),
            operator: z.enum(CALCULATOR_OPERATORS),
            expression: z.string(),
            result: z.number().optional(),
            error: z.string().optional()
        })
    },
    async ({ a, b, operator }) => {
        try {
            const result = calculate(a, b, operator)
            const expression = `${a} ${operator} ${b}`
            return textResult(`${expression} = ${result}`, {
                a,
                b,
                operator,
                expression,
                result
            })
        } catch (error) {
            const message =
                error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
            const expression = `${a} ${operator} ${b}`
            return textResult(`계산 실패: ${message}`, {
                a,
                b,
                operator,
                expression,
                error: message
            }, true)
        }
    }
)

server.registerTool(
    'get-weather',
    {
        description:
            '위도와 경도를 받아 Open-Meteo Forecast API로 현재 날씨와 단기 예보를 조회합니다. geocode 도구로 좌표를 먼저 얻은 뒤 사용하세요.',
        inputSchema: z.object({
            latitude: z
                .number()
                .min(-90)
                .max(90)
                .describe('위도 (geocode 결과의 latitude)'),
            longitude: z
                .number()
                .min(-180)
                .max(180)
                .describe('경도 (geocode 결과의 longitude)'),
            forecastDays: z
                .number()
                .int()
                .min(1)
                .max(16)
                .optional()
                .default(3)
                .describe('예보 일수 (1~16, 기본값: 3)')
        }),
        outputSchema: z.object({
            latitude: z.number(),
            longitude: z.number(),
            timezone: z.string().optional(),
            current: z
                .object({
                    time: z.string(),
                    temperatureC: z.number(),
                    apparentTemperatureC: z.number(),
                    humidity: z.number(),
                    precipitationMm: z.number(),
                    weatherCode: z.number(),
                    weather: z.string(),
                    cloudCover: z.number(),
                    windSpeedKmh: z.number(),
                    windDirection: z.string(),
                    isDay: z.boolean()
                })
                .optional(),
            daily: z
                .array(
                    z.object({
                        date: z.string(),
                        weatherCode: z.number(),
                        weather: z.string(),
                        temperatureMaxC: z.number(),
                        temperatureMinC: z.number(),
                        precipitationSumMm: z.number(),
                        precipitationProbabilityMax: z.number()
                    })
                )
                .optional()
        })
    },
    async ({ latitude, longitude, forecastDays }) => {
        try {
            const url = new URL(FORECAST_API_URL)
            url.searchParams.set('latitude', String(latitude))
            url.searchParams.set('longitude', String(longitude))
            url.searchParams.set(
                'current',
                [
                    'temperature_2m',
                    'relative_humidity_2m',
                    'apparent_temperature',
                    'precipitation',
                    'weather_code',
                    'cloud_cover',
                    'wind_speed_10m',
                    'wind_direction_10m',
                    'is_day'
                ].join(',')
            )
            url.searchParams.set(
                'daily',
                [
                    'weather_code',
                    'temperature_2m_max',
                    'temperature_2m_min',
                    'precipitation_sum',
                    'precipitation_probability_max'
                ].join(',')
            )
            url.searchParams.set('timezone', 'auto')
            url.searchParams.set('forecast_days', String(forecastDays))

            const data = await fetchJson<ForecastResponse>(url.toString())

            const current = data.current
                ? {
                      time: data.current.time,
                      temperatureC: data.current.temperature_2m,
                      apparentTemperatureC: data.current.apparent_temperature,
                      humidity: data.current.relative_humidity_2m,
                      precipitationMm: data.current.precipitation,
                      weatherCode: data.current.weather_code,
                      weather: describeWeather(data.current.weather_code),
                      cloudCover: data.current.cloud_cover,
                      windSpeedKmh: data.current.wind_speed_10m,
                      windDirection: cardinalDirection(data.current.wind_direction_10m),
                      isDay: data.current.is_day === 1
                  }
                : undefined

            const dailyData = data.daily
            const daily = dailyData?.time.map((date, index) => ({
                date,
                weatherCode: dailyData.weather_code[index] ?? 0,
                weather: describeWeather(dailyData.weather_code[index] ?? 0),
                temperatureMaxC: dailyData.temperature_2m_max[index] ?? 0,
                temperatureMinC: dailyData.temperature_2m_min[index] ?? 0,
                precipitationSumMm: dailyData.precipitation_sum[index] ?? 0,
                precipitationProbabilityMax:
                    dailyData.precipitation_probability_max[index] ?? 0
            }))

            const structuredContent = {
                latitude: data.latitude,
                longitude: data.longitude,
                timezone: data.timezone,
                current,
                daily
            }

            const currentLine = current
                ? `현재 (${current.time}, ${data.timezone ?? 'local'}): ${current.weather}, ${current.temperatureC}°C (체감 ${current.apparentTemperatureC}°C), 습도 ${current.humidity}%, 강수량 ${current.precipitationMm}mm, 풍속 ${current.windSpeedKmh}km/h (${current.windDirection}), 구름 ${current.cloudCover}%`
                : '현재 날씨 정보가 없습니다.'

            const dailyLines = (daily ?? [])
                .map(
                    (day) =>
                        `- ${day.date}: ${day.weather}, 최고 ${day.temperatureMaxC}°C / 최저 ${day.temperatureMinC}°C, 강수 ${day.precipitationSumMm}mm (확률 ${day.precipitationProbabilityMax}%)`
                )
                .join('\n')

            return textResult(
                `위치 ${data.latitude}, ${data.longitude}\n${currentLine}${dailyLines ? `\n\n${forecastDays}일 예보:\n${dailyLines}` : ''}`,
                structuredContent
            )
        } catch (error) {
            const message =
                error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
            return textResult(
                `날씨 조회 실패: ${message}`,
                { latitude, longitude },
                true
            )
        }
    }
)

server.registerTool(
    'generate-image',
    {
        description:
            'HuggingFace Inference API(FLUX.1-schnell)로 텍스트 프롬프트에서 이미지를 생성합니다.',
        inputSchema: z.object({
            prompt: z.string().min(1).describe('이미지 생성 프롬프트'),
            num_inference_steps: z
                .number()
                .int()
                .min(1)
                .max(10)
                .optional()
                .default(4)
                .describe('추론 스텝 수 (1~10, 기본값: 4)')
        }),
        outputSchema: z.object({
            content: z.array(
                z.union([
                    z.object({
                        type: z.literal('image'),
                        data: z.string(),
                        mimeType: z.literal('image/png')
                    }),
                    z.object({
                        type: z.literal('text'),
                        text: z.string()
                    })
                ])
            ),
            structuredContent: z.object({
                prompt: z.string(),
                num_inference_steps: z.number().optional(),
                mimeType: z.literal('image/png').optional()
            })
        })
    },
    async ({ prompt, num_inference_steps }) => {
        const hfToken = process.env.HF_TOKEN
        if (!hfToken) {
            return textResult(
                'HF_TOKEN 환경변수가 설정되어 있지 않습니다. HuggingFace API 토큰을 설정한 뒤 다시 시도하세요.',
                { prompt, num_inference_steps },
                true
            )
        }

        try {
            const client = new InferenceClient(hfToken)
            const image = await client.textToImage(
                {
                    provider: 'together',
                    model: 'black-forest-labs/FLUX.1-schnell',
                    inputs: prompt,
                    parameters: { num_inference_steps }
                },
                { outputType: 'blob' }
            )

            const base64 = Buffer.from(await image.arrayBuffer()).toString('base64')

            return {
                content: [
                    {
                        type: 'image' as const,
                        data: base64,
                        mimeType: 'image/png' as const
                    }
                ],
                structuredContent: {
                    prompt,
                    num_inference_steps,
                    mimeType: 'image/png' as const
                }
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
            return textResult(
                `이미지 생성 실패: ${message}`,
                { prompt, num_inference_steps },
                true
            )
        }
    }
)

const SERVER_INFO_URI = 'config://server-info'

server.registerResource(
    'server-info',
    SERVER_INFO_URI,
    {
        title: '서버 구성 정보',
        description:
            '이 MCP 서버의 구성(도구, 전송 방식, 외부 API)과 가짜 운영 정보를 반환합니다.',
        mimeType: 'application/json'
    },
    async (uri) => {
        const fakeServerInfo = {
            mock: true,
            notice: '아래 runtime/ops 필드는 학습용 가짜 데이터입니다.',
            generatedAt: new Date().toISOString(),
            server: {
                name: 'typescript-mcp-server',
                version: '1.0.0',
                language: 'TypeScript',
                description:
                    'Open-Meteo 지오코딩·날씨 조회, 이미지 생성, 계산기, 인사 도구를 제공하는 연습용 MCP 서버'
            },
            runtime: {
                environment: 'staging',
                region: 'ap-northeast-2',
                availabilityZone: 'ap-northeast-2c',
                instanceId: 'mcp-fake-7f3a21',
                hostname: 'mcp-node-07.fake.internal',
                replicaCount: 3,
                transport: 'stdio',
                protocol: 'MCP',
                nodeVersion: process.version,
                pid: process.pid,
                uptimeSeconds: Math.round(process.uptime())
            },
            capabilities: {
                tools: true,
                resources: true,
                prompts: false,
                logging: false
            },
            tools: [
                {
                    name: 'greet',
                    description: '이름과 언어를 받아 인사말을 반환합니다.',
                    languages: ['ko', 'en']
                },
                {
                    name: 'geocode',
                    description: '도시명/주소를 위도·경도로 변환합니다.',
                    provider: 'Open-Meteo Geocoding'
                },
                {
                    name: 'get-weather',
                    description: '좌표로 현재 날씨와 단기 예보를 조회합니다.',
                    provider: 'Open-Meteo Forecast'
                },
                {
                    name: 'generate-image',
                    description: '텍스트 프롬프트로 이미지를 생성합니다.',
                    provider: 'HuggingFace Inference (FLUX.1-schnell)'
                },
                {
                    name: 'calculator',
                    description: '두 숫자와 연산자로 사칙연산 결과를 반환합니다.',
                    operators: ['+', '-', '*', '/']
                }
            ],
            resources: [
                {
                    name: 'server-info',
                    uri: SERVER_INFO_URI,
                    mimeType: 'application/json'
                }
            ],
            externalApis: [
                {
                    name: 'Open-Meteo Geocoding',
                    baseUrl: GEOCODING_API_URL
                },
                {
                    name: 'Open-Meteo Forecast',
                    baseUrl: FORECAST_API_URL
                },
                {
                    name: 'HuggingFace Inference',
                    model: 'black-forest-labs/FLUX.1-schnell',
                    provider: 'together'
                }
            ],
            limits: {
                geocodeMaxResults: 10,
                forecastDaysMin: 1,
                forecastDaysMax: 16,
                imageInferenceStepsMin: 1,
                imageInferenceStepsMax: 10
            },
            ops: {
                owner: 'platform-team',
                oncall: 'mcp-weather-fake',
                status: 'healthy',
                lastDeployedAt: '2026-09-12T08:30:00.000Z'
            }
        }

        return {
            contents: [
                {
                    uri: uri.href,
                    mimeType: 'application/json',
                    text: JSON.stringify(fakeServerInfo, null, 2)
                }
            ]
        }
    }
)

server
    .connect(new StdioServerTransport())
    .catch(console.error)
    .then(() => {
        console.error('MCP server started')
    })
