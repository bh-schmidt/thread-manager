import { AsyncLocalStorage } from "async_hooks";

export namespace ExecutionContext {
    const als = new AsyncLocalStorage()

    export function run<T>(obj: Record<string, any>, callback: () => T) {
        const currentObj = als.getStore() ?? {}

        return als.run(
            {
                ...currentObj,
                ...obj
            }, callback)
    }

    export function getStore<T = unknown>() {
        return als.getStore() as T
    }
}