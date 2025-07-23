import { equal } from "assert"
import { MessageChannel } from "worker_threads"
import { PromiseHandler } from "../src/Workers/PromiseHandler"
import { WorkerPool } from "../src/Workers/WorkerPool"
import { MiddleWorkerInput, MiddleWorkerOutput } from "./scripts/middle-worker"

describe('pool.run using a global pool', () => {
    let pool: WorkerPool
    let channel: MessageChannel

    afterEach(async () => {
        await pool?.terminate()
    })

    it('should run a worker from inside a worker', async () => {
        const name = 'global-pool'
        pool = new WorkerPool({
            globalPool: true,
            poolName: name,
            idleTimeout: 200,
            maxWorkers: 2
        })

        const input: MiddleWorkerInput = {
            poolName: name,
            payload: [2, 2],
            fileName: './scripts/slow-sum.js',
            moduleUrl: import.meta.url
        }

        const result = await pool.run<MiddleWorkerOutput<number>>(input, {
            fileName: './scripts/middle-worker.js',
            moduleUrl: import.meta.url
        })
        equal(result.result, 4)
        const workers = await pool.getWorkers()
        equal(workers.length, 2)
    })

    it('should run a specific function of a worker', async () => {
        const name = 'global-pool'
        pool = new WorkerPool({
            globalPool: true,
            poolName: name,
            idleTimeout: 200,
            maxWorkers: 2
        })

        const input: MiddleWorkerInput = {
            poolName: name,
            payload: [2, 2],
            fileName: './scripts/math.js',
            moduleUrl: import.meta.url,
            functionName: 'sum'
        }

        const result = await pool.run<MiddleWorkerOutput<number>>(input, {
            fileName: './scripts/middle-worker.js',
            moduleUrl: import.meta.url
        })
        equal(result.result, 4)
        const workers = await pool.getWorkers()
        equal(workers.length, 2)
    })

    it('should run a worker and communicate via message port', async () => {
        const name = 'global-pool'
        pool = new WorkerPool({
            globalPool: true,
            poolName: name,
            idleTimeout: 200,
            maxWorkers: 2
        })

        channel = new MessageChannel()
        const portName = 'main'

        const input: MiddleWorkerInput = {
            poolName: name,
            payload: portName,
            fileName: './scripts/message-port.js',
            moduleUrl: import.meta.url,
        }

        const prom = pool.run<MiddleWorkerOutput<number>>(input, {
            fileName: './scripts/middle-worker.js',
            moduleUrl: import.meta.url,
            messagePorts: {
                [portName]: channel.port2
            }
        })

        const workerId = await prom.getWorkerId()
        channel.port1.postMessage('message')
        const result = await prom

        const workers = await pool.getWorkers()
        equal(workerId, workers[0].id)

        equal(result.result, undefined)
        const queue = await pool.getQueue()
        equal(queue.length, 0)
        equal(workers.length, 2)
    })

    it('should run 2 workers but prevent a third because the maximum worker tree is 2', async () => {
        const name = 'global-pool'

        pool = new WorkerPool({
            globalPool: true,
            poolName: name,
            idleTimeout: 200,
            maxWorkers: 2
        })

        const input1: MiddleWorkerInput = {
            poolName: name,
            payload: [2, 2],
            fileName: './scripts/slow-sum.js',
            moduleUrl: import.meta.url
        }

        const input2: MiddleWorkerInput = {
            poolName: name,
            payload: input1,
            fileName: './scripts/middle-worker.js',
            moduleUrl: import.meta.url
        }

        await expect(
            async () => {
                await pool.run<MiddleWorkerOutput<number>>(input2, {
                    fileName: './scripts/middle-worker.js',
                    moduleUrl: import.meta.url
                })
            })
            .rejects.toThrow('The worker chain for this task achieved the maximum size (2), which is the maximum quantity of workers.')

        const workers = await pool.getWorkers()
        expect(workers.length).toBe(2)
    })

    it('should run a worker and wait the removal of all workers', async () => {
        const name = 'global-pool'
        pool = new WorkerPool({
            globalPool: true,
            poolName: name,
            idleTimeout: 200,
        })

        const input: MiddleWorkerInput = {
            poolName: name,
            payload: [2, 2],
            fileName: './scripts/slow-sum.js',
            moduleUrl: import.meta.url
        }

        const result = await pool.run<MiddleWorkerOutput<number>>(input, {
            fileName: './scripts/middle-worker.js',
            moduleUrl: import.meta.url
        })

        equal(result.result, 4)
        const workers1 = await pool.getWorkers()
        equal(workers1.length, 2)

        const handlers = [new PromiseHandler(), new PromiseHandler()]
        const proms = handlers.map(e => e.promise)

        pool.on('worker-removed', () => {
            const handler = handlers.shift()
            handler?.resolve()
        })

        await Promise.all(proms)
        const workers2 = await pool.getWorkers()
        equal(workers2.length, 0)
    })

    it('should wait for a pool event inside a worker and remove the listener', async () => {
        const name = 'global-pool'
        pool = new WorkerPool({
            globalPool: true,
            poolName: name,
        })

        const eventId = crypto.randomUUID()
        const input: MiddleWorkerInput = {
            poolName: name,
            payload: [2, 2],
            fileName: './scripts/slow-sum.js',
            moduleUrl: import.meta.url,
            waitEvents: [
                {
                    eventName: 'worker-removed',
                    id: eventId,
                    type: 'on'
                }
            ],
            offEvents: [
                {
                    eventName: 'worker-removed',
                    id: eventId
                }
            ]
        }

        const result = await pool.run<MiddleWorkerOutput<number>>(input, {
            fileName: './scripts/middle-worker.js',
            moduleUrl: import.meta.url
        })

        equal(result.result, 4)
        expect(result.eventResults).toHaveLength(1)
        const workers = await pool.getWorkers()
        equal(workers.length, 1)
        const listenersCount = pool.listenerCount('worker-removed')
        expect(listenersCount).toBe(0)
    })
})