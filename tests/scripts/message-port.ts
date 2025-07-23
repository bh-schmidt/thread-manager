import { FunctionArgs } from "../../src/Workers/Types";

export default async function ({ payload, messagePorts }: FunctionArgs<string>) {
    if (!messagePorts) {
        return
    }

    if (!payload) {
        return
    }

    await new Promise<void>((res, rej) => {
        const port = messagePorts[payload];

        port.once('close', () => {
            rej()
        })

        port.once('message', () => {
            res()
        })

        port.on('messageerror', () => {
            rej()
        })
    })
}