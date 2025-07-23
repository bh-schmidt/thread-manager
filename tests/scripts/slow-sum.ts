import { FunctionArgs } from "../../src/Workers/Types"
import { Delay } from "../fixture/Delay"

export default async function sum({ payload }: FunctionArgs<number[]>) {
    payload ??= []
    await Delay.of(200)
    return payload.reduce((prev, cur) => prev + cur, 0)
}