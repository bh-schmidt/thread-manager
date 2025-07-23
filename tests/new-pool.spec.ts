import { WorkerPool } from "../src/Workers/WorkerPool"

describe('instancing new WorkerPool', () => {
    let pool: WorkerPool

    afterEach(async () => {
        await pool?.terminate()
    })

    it('should create global a new pool with a specific name', () => {
        pool = new WorkerPool({
            poolName: 'my-pool',
            globalPool: true
        })

        expect(pool.options.poolName).toBe('my-pool')
    })

    it('should prevent from creating two global pools with the same name', () => {
        const name = 'my-pool'
        pool = new WorkerPool({
            poolName: name,
            globalPool: true
        })

        expect(pool.options.poolName).toBe('my-pool')

        expect(() => {
            new WorkerPool({
                poolName: name,
                globalPool: true
            })
        }).toThrow(`There already is a global pool with name '${name}' instanced.`)
    })

    it('should prevent from creating a pool with maxWorkers < 1', () => {
        expect(() => {
            new WorkerPool({
                maxWorkers: 0
            })
        }).toThrow(`'maxWorkers' should be greater than '0'.`)
    })

    it('should prevent from creating a pool with minWorkers > maxWorkers', () => {
        expect(() => {
            pool = new WorkerPool({
                minWorkers: 2,
                maxWorkers: 1
            })
        }).toThrow(`'minWorkers' should be smaller than or equal to 'maxWorkers'.`)
    })
})