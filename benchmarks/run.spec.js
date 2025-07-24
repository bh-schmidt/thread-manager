import Piscina from "piscina";
import { Bench } from "tinybench";
import { Workers } from "../dist/src/Index.js";
import assert from "assert";

/**
 * @type {Workers.WorkerPool} 
 */
let pool

/**
 * @type {Piscina}
 */
let piscina

const bench = new Bench({
    name: 'Run basic sum script while instancing the class'
})

const workersCount = 4;

// const url = new URL('./scripts/sum.js', import.meta.url).href
// const filePath = 

const iterations = 1000

bench.add(
    'Piscina',
    async () => {
        piscina = new Piscina()
        for (let i = 0; i < iterations; i++) {
            const result = await piscina.run([2, 2], {
                filename: new URL('./scripts/piscina-sum.js', import.meta.url).href
            })

            assert(result == 4)
        }
    },
    {
        afterEach: async () => {
            await piscina?.close()
        }
    })

bench.add(
    'WorkerPool',
    async () => {
        pool = new Workers.WorkerPool()
        for (let i = 0; i < iterations; i++) {
            const result = await pool.run([2, 2], {
                fileName: new URL('./scripts/sum.js', import.meta.url)
            })
            assert(result == 4)
        }
    },
    {
        afterEach: async () => {
            await pool?.terminate()
        }
    })

bench.add(
    'WorkerPool (global)',
    async () => {
        pool = new Workers.WorkerPool({
            globalPool: true
        })
        for (let i = 0; i < iterations; i++) {
            const result = await pool.run([2, 2], {
                fileName: new URL('./scripts/sum.js', import.meta.url)
            })
            assert(result == 4)
        }
    },
    {
        afterEach: async () => {
            await pool?.terminate()
        }
    })

/**
 * @type {Bench}
 */
export default bench