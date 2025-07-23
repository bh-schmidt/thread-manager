import { FunctionArgs } from "../../src/Workers/Types";

export default function env({ payload }: FunctionArgs<string[]>) {
    return payload.map(e => process.env[e])
}