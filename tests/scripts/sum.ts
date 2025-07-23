import { FunctionArgs } from "../../src/Workers/Types"

export default function sum({ payload}: FunctionArgs<number[]>) {
    payload ??= []
    return payload.reduce((prev, cur) => prev + cur, 0)
}