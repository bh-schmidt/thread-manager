import { Bench } from "tinybench";
import { Workers } from "../dist/src/Index.js";
import Piscina from "piscina";

/**
 * @type {Workers.WorkerPool} 
 */
let pool

/**
 * @type {Piscina}
 */
let piscina

const bench = new Bench({
    name: 'Instancing pools'
})

bench.add(
    'Piscina',
    () => {
        piscina = new Piscina()
    },
    {
        afterEach: async () => {
            await piscina?.close()
        }
    })

bench.add(
    'WorkerPool',
    () => {
        pool = new Workers.WorkerPool()
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