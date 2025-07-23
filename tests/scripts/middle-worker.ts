import { PromiseHandler } from "../../src/Workers/PromiseHandler"
import { FunctionArgs, PoolEventKeys } from "../../src/Workers/Types"
import { WorkerPool } from "../../src/Workers/WorkerPool"

export interface AddEventInput {
    id: string
    eventName: PoolEventKeys
    type: 'once' | 'on'
}

export interface OffEventInput {
    id: string
    eventName: PoolEventKeys
}

export interface EventResult {
    id: string
    result: any[]
}

export interface MiddleWorkerInput {
    poolName: string,
    payload: any,
    fileName: string | URL
    moduleUrl: string
    functionName?: string
    waitEvents?: AddEventInput[]
    offEvents?: OffEventInput[]
}

export interface MiddleWorkerOutput<T = any> {
    result: T,
    eventResults?: EventResult[]
}

export default async function ({ payload, messagePorts }: FunctionArgs<MiddleWorkerInput>): Promise<MiddleWorkerOutput> {
    const pool = new WorkerPool({
        poolName: payload.poolName,
        globalPool: true
    })

    const events: [id: string, function: any][] = []
    const promises: Promise<EventResult>[] = []

    try {
        if (payload.waitEvents) {
            for (const ev of payload.waitEvents) {
                const ph = new PromiseHandler<EventResult>()
                promises.push(ph.promise)

                const handler = (...args: any[]): void => {
                    ph.resolve({
                        id: ev.id,
                        result: args
                    })
                }

                events.push([ev.id, handler])

                if (ev.type == 'on') {
                    pool.on(ev.eventName as any, handler)
                }
                else {
                    pool.once(ev.eventName as any, handler)
                }
            }
        }

        const runResult = await pool.run(payload.payload, {
            fileName: payload.fileName,
            moduleUrl: payload.moduleUrl,
            functionName: payload.functionName,
            messagePorts
        })

        const results = await Promise.all(promises)

        if (payload.offEvents) {
            for (const ev of payload.offEvents) {
                const [_, handler] = events.find(e => e[0] == ev.id)!
                pool.off(ev.eventName as any, handler)
            }
        }

        return {
            result: runResult,
            eventResults: results
        }
    } finally {
        await pool.terminate()
    }
}