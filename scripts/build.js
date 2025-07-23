import { execa } from "execa"
import { remove } from "fs-extra"

const options = {
    stdio: 'inherit',
    reject: false,
}

await remove('dist')

const isDev = process.argv.includes('--dev')

const result = isDev ?
    await execa('tsc --noUnusedLocals false --noUnusedParameters false && tsc-alias', options)
    :
    await execa('tsc && tsc-alias', options)

if (result.failed) {
    process.exit(result.exitCode)
}