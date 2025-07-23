import { FunctionArgs } from "../../src/Workers/Types"

export function sum({ payload }: FunctionArgs<number[]>) {
    payload ??= []
    return payload.reduce((prev, cur) => prev + cur, 0)
}