import { equal } from "assert"
import { WorkerPool } from "../src/Workers/WorkerPool"

describe('pool.ensureWorkers', () => {
    let pool: WorkerPool

    afterEach(async () => {
        await pool?.terminate()
    })

    it('should create 2 workers because minWorkers=2', async () => {
        pool = new WorkerPool({
            minWorkers: 2
        })
        await pool.ensureWorkers()
        const workers = await pool.getWorkers()
        equal(workers.length, 2)
    })

    it('should not create a worker because minWorkers=0', async () => {
        pool = new WorkerPool({
            minWorkers: 0
        })
        await pool.ensureWorkers()
        const workers = await pool.getWorkers()
        equal(workers.length, 0)
    })
})