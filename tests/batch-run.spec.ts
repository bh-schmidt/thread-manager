import { WorkerPool } from "../src/Workers/WorkerPool"

describe('batch pool.run', () => {
    let pool: WorkerPool

    afterEach(async () => {
        await pool?.terminate()
    })

    it('should run a batch of workers and achieve the maximum parallelism', async () => {
        const parallelism = 4
        const batchSize = 100
        pool = new WorkerPool({
            maxWorkers: parallelism
        })

        const promises: Promise<number>[] = []
        for (let index = 0; index < batchSize; index++) {
            const prom = pool.run<number>([index, index], {
                fileName: './scripts/sum.js',
                moduleUrl: import.meta.url
            })
            promises.push(prom)
        }

        const results = await Promise.all(promises)
        const workers = await pool.getWorkers()
        expect(workers.length)
            .toBe(parallelism)

        for (let index = 0; index < batchSize; index++) {
            const result = results[index];
            expect(result).toBe(index + index)
        }
    })
})