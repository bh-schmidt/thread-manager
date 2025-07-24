import { execa } from "execa";
import { glob } from "glob";
import { Bench } from "tinybench";
import { pathToFileURL } from 'url';

const benchmarkName = process.argv[2]

const result = await execa('npm run build -- --dev', {
    reject: false,
    stdio: 'inherit',
})

if (result.failed) {
    process.exit(1)
}

const benchmarks = await glob('**/*.spec.js', {
    cwd: 'benchmarks',
    absolute: true
})

for (const file of benchmarks) {
    console.log()
    console.log(` - ${file}`)

    const url = pathToFileURL(file).href

    const module = await import(url)
    if (!module?.default) {
        console.warn('Benchmark not exported as default module.')
        continue
    }

    /**
     * @type {Bench}
     */
    const bench = module.default

    console.log()
    console.log(`${bench.name}:`)

    if (benchmarkName && bench.name != benchmarkName) {
        console.log(' - skipped')
        continue
    }

    await bench.run()

    const tableData = bench.tasks.map(({ name, result }) => {
        return ({
            "task": name,
            "avg": formatNumber(result?.latency?.mean * 1000),
            // "Variance (ps)": formatNumber(result?.latency?.variance * 1000),
            "std.dev": formatNumber(result?.latency?.sd * 1000),
            "p50": formatNumber(result?.latency?.p50 * 1000),
            "p75": formatNumber(result?.latency?.p75 * 1000),
            "p99": formatNumber(result?.latency?.p99 * 1000),
            "p999": formatNumber(result?.latency?.p999 * 1000),
            "rme": formatNumber(result?.latency?.rme)
        });
    })

    console.table(tableData);
}

function formatNumber(value, decimals = 3) {
    return value?.toFixed(decimals)
}