import { equal } from "assert"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { MessageChannel } from "worker_threads"
import { PromiseHandler } from "../src/Workers/PromiseHandler"
import { WorkerPool } from "../src/Workers/WorkerPool"
import { Piscina } from 'piscina'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

describe('pool.run', () => {
    let pool: WorkerPool
    let channel: MessageChannel

    afterEach(async () => {
        await pool?.terminate()
        channel?.port1.close()
        channel?.port2.close()
    })

    it(`should run a worker using the pool's default file full path`, async () => {
        pool = new WorkerPool({
            fileName: join(__dirname, './scripts/sum.js')
        })
        const result = await pool.run<number>([2, 2], {})

        equal(result, 4)
        const queue = await pool.getQueue()
        equal(queue.length, 0)
        const workers = await pool.getWorkers()
        equal(workers.length, 1)
    })

    it(`should run a worker using the pool's default file URL`, async () => {
        pool = new WorkerPool({
            fileName: new URL('./scripts/sum.js', import.meta.url)
        })
        const result = await pool.run<number>([2, 2], {})

        equal(result, 4)
        const queue = await pool.getQueue()
        equal(queue.length, 0)
        const workers = await pool.getWorkers()
        equal(workers.length, 1)
    })

    it(`should run a worker using the pool's default file module url`, async () => {
        pool = new WorkerPool({
            fileName: './scripts/sum.js',
            moduleUrl: import.meta.url
        })
        const result = await pool.run<number>([2, 2], {})

        equal(result, 4)
        const queue = await pool.getQueue()
        equal(queue.length, 0)
        const workers = await pool.getWorkers()
        equal(workers.length, 1)
    })

    it(`should run a worker using the file full path and ignore the pool's default file`, async () => {
        pool = new WorkerPool({
            fileName: './scripts/should-be-ignored.js',
            moduleUrl: import.meta.url
        })
        const result = await pool.run<number>([2, 2], {
            fileName: join(__dirname, './scripts/sum.js')
        })

        equal(result, 4)
        const queue = await pool.getQueue()
        equal(queue.length, 0)
        const workers = await pool.getWorkers()
        equal(workers.length, 1)
    })

    it(`should run a worker using the file URL and ignore the pool's default file`, async () => {
        pool = new WorkerPool({
            fileName: './scripts/should-be-ignored.js',
            moduleUrl: import.meta.url
        })
        const result = await pool.run<number>([2, 2], {
            fileName: new URL('./scripts/sum.js', import.meta.url)
        })

        equal(result, 4)
        const queue = await pool.getQueue()
        equal(queue.length, 0)
        const workers = await pool.getWorkers()
        equal(workers.length, 1)
    })

    it(`should run a worker using the file module url and ignore the pool's default file`, async () => {
        pool = new WorkerPool({
            fileName: './scripts/should-be-ignored.js',
            moduleUrl: import.meta.url
        })
        const result = await pool.run<number>([2, 2], {
            fileName: './scripts/sum.js',
            moduleUrl: import.meta.url
        })

        equal(result, 4)
        const queue = await pool.getQueue()
        equal(queue.length, 0)
        const workers = await pool.getWorkers()
        equal(workers.length, 1)
    })

    it('should run 2 tasks and scale 2 workers', async () => {
        pool = new WorkerPool({})
        const prom1 = pool.run<number>([2, 2], {
            fileName: './scripts/slow-sum.js',
            moduleUrl: import.meta.url
        })
        const prom2 = pool.run<number>([3, 3], {
            fileName: './scripts/slow-sum.js',
            moduleUrl: import.meta.url
        })

        const result1 = await prom1
        const result2 = await prom2

        equal(result1, 4)
        equal(result2, 6)

        const queue = await pool.getQueue()
        equal(queue.length, 0)
        const workers = await pool.getWorkers()
        equal(workers.length, 2)
    })

    it('should run 2 tasks without scaling bacause of maxWorkers=1', async () => {
        pool = new WorkerPool({
            maxWorkers: 1
        })

        const prom1 = pool.run<number>([2, 2], {
            fileName: './scripts/slow-sum.js',
            moduleUrl: import.meta.url
        })
        const prom2 = pool.run<number>([3, 3], {
            fileName: './scripts/slow-sum.js',
            moduleUrl: import.meta.url
        })

        const result1 = await prom1
        const result2 = await prom2

        equal(result1, 4)
        equal(result2, 6)

        const queue = await pool.getQueue()
        equal(queue.length, 0)
        const workers = await pool.getWorkers()
        equal(workers.length, 1)
    })

    it('should run a task and start 2 workers because minWorkers=2', async () => {
        pool = new WorkerPool({
            minWorkers: 2
        })

        const res = await pool.run<number>([2, 2], {
            fileName: './scripts/slow-sum.js',
            moduleUrl: import.meta.url
        })

        equal(res, 4)

        const queue = await pool.getQueue()
        equal(queue.length, 0)
        const workers = await pool.getWorkers()
        equal(workers.length, 2)
    })

    it('should run a task and get the worker id', async () => {
        pool = new WorkerPool({
            minWorkers: 2
        })
        const prom = pool.run<number>([2, 2], {
            fileName: './scripts/slow-sum.js',
            moduleUrl: import.meta.url
        })

        const workerId = await prom.getWorkerId()
        const res = await prom
        const workers = await pool.getWorkers()

        equal(workerId, workers[0].id)
        equal(res, 4)

        const queue = await pool.getQueue()
        equal(queue.length, 0)
        equal(workers.length, 2)
    })

    it('should run a specific function of a worker', async () => {
        pool = new WorkerPool({
            minWorkers: 2
        })
        const res = await pool.run<number>([2, 2], {
            fileName: './scripts/math.js',
            moduleUrl: import.meta.url,
            functionName: 'sum'
        })

        equal(res, 4)
        const queue = await pool.getQueue()
        equal(queue.length, 0)
        const workers = await pool.getWorkers()
        equal(workers.length, 2)
    })

    it('should run a worker and communicate via message port', async () => {
        pool = new WorkerPool({})

        channel = new MessageChannel()
        const portName = 'main'

        const prom = pool.run(portName, {
            fileName: './scripts/message-port.js',
            moduleUrl: import.meta.url,
            messagePorts: {
                [portName]: channel.port2
            }
        })

        channel.port1.postMessage('')
        const res = await prom

        equal(res, undefined)
        const queue = await pool.getQueue()
        equal(queue.length, 0)
        const workers = await pool.getWorkers()
        equal(workers.length, 1)
    })

    it('should run a worker and remove idle workers after', async () => {
        pool = new WorkerPool()
        const result = await pool.run<number>([2, 2], {
            fileName: join(__dirname, './scripts/sum.js')
        })

        equal(result, 4)
        const queue = await pool.getQueue()
        equal(queue.length, 0)

        await new Promise<void>((res) => {
            pool.once('worker-removed', () => {
                res()
            })
        })

        const workers = await pool.getWorkers()
        equal(workers.length, 0)
    })

    it('should run a worker and return the new env variables without removing other variables', async () => {
        const var1 = 'myText'
        const var2 = 'myText2'
        const var3 = 'myText3'
        pool = new WorkerPool({
            env: {
                [var1]: 'v1'
            },
            updateEnvStrategy: 'deep-merge'
        })

        await pool.run<string>([], {
            fileName: join(__dirname, './scripts/env.js'),
            env: {
                [var2]: 'v2'
            }
        })

        const res = await pool.run<string>([var1, var2, var3], {
            fileName: join(__dirname, './scripts/env.js'),
            env: {
                [var3]: 'v3'
            }
        })

        expect(res).toStrictEqual(['v1', 'v2', 'v3'])
        const queue = await pool.getQueue()
        equal(queue.length, 0)
    })

    it('should run a worker and return the new env variables removing old worker variables', async () => {
        const var1 = 'myText'
        const var2 = 'myText2'
        const var3 = 'myText3'
        pool = new WorkerPool({
            env: {
                [var1]: 'v1'
            },
            updateEnvStrategy: 'shallow-merge'
        })

        await pool.run<string>([], {
            fileName: join(__dirname, './scripts/env.js'),
            env: {
                [var2]: 'v2'
            }
        })

        const res = await pool.run<string>([var1, var2, var3], {
            fileName: join(__dirname, './scripts/env.js'),
            env: {
                [var3]: 'v3'
            }
        })

        expect(res).toStrictEqual(['v1', undefined, 'v3'])
        const queue = await pool.getQueue()
        equal(queue.length, 0)
    })

    it('should run a worker and return the new env variables replacing all worker variables', async () => {
        const var1 = 'myText'
        const var2 = 'myText2'
        const var3 = 'myText3'
        pool = new WorkerPool({
            env: {
                [var1]: 'v1'
            },
            updateEnvStrategy: 'replace'
        })

        await pool.run<string>([], {
            fileName: join(__dirname, './scripts/env.js'),
            env: {
                [var2]: 'v2'
            }
        })

        const res = await pool.run<string>([var1, var2, var3], {
            fileName: join(__dirname, './scripts/env.js'),
            env: {
                [var3]: 'v3'
            }
        })

        expect(res).toStrictEqual(['v1', undefined, 'v3'])
        const queue = await pool.getQueue()
        equal(queue.length, 0)
    })

    it('should auto update the variables setted because autoUpdateEnv is enabled on the pool', async () => {
        const var1 = 'myText'
        pool = new WorkerPool({
            env: {
                [var1]: 'v1'
            },
            autoUpdateEnv: true
        })

        const res1 = await pool.run<string>([var1], {
            fileName: join(__dirname, './scripts/env.js'),
            env: {
                [var1]: 'v2'
            }
        })
        expect(res1).toStrictEqual(['v2'])

        const res2 = await pool.run<string>([var1], {
            fileName: join(__dirname, './scripts/env.js'),
        })
        expect(res2).toStrictEqual(['v1'])
    })

    it('should auto update the variables setted because autoUpdateEnv is enabled on the last run', async () => {
        const var1 = 'myText'
        pool = new WorkerPool({
            env: {
                [var1]: 'v1'
            },
        })

        const res1 = await pool.run<string>([var1], {
            fileName: join(__dirname, './scripts/env.js'),
            env: {
                [var1]: 'v2'
            }
        })
        expect(res1).toStrictEqual(['v2'])

        const res2 = await pool.run<string>([var1], {
            fileName: join(__dirname, './scripts/env.js'),
            autoUpdateEnv: true
        })
        expect(res2).toStrictEqual(['v1'])
    })

    it(`should extend the idleTimeout after the running a worker`, async () => {
        const timeout = 150
        pool = new WorkerPool({
            fileName: join(__dirname, './scripts/sum.js'),
            idleTimeout: timeout
        })
        const result = await pool.run<number>([2, 2], {})

        equal(result, 4)
        const queue = await pool.getQueue()
        equal(queue.length, 0)

        let readyDate: Date = new Date()
        let removedDate: Date

        const removedPH = new PromiseHandler()

        pool.on('worker-removed', () => {
            removedDate = new Date()
            removedPH.resolve()
        })

        await Promise.all([removedPH.promise])

        const difference = removedDate!.getTime() - readyDate!.getTime()
        expect(difference).toBeGreaterThanOrEqual(timeout)
    })
})