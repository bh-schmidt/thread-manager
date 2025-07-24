import { MessagePort } from "worker_threads"
import { WorkerImp } from "./WorkerImp"

export type UpdateEnvStrategy = 'replace' | 'shallow-merge' | 'deep-merge'
export type WorkerStatus = 'created' | 'starting' | 'ready' | 'idle' | 'running' | 'closed'
export type TaskStatus = 'queued' | 'running' | 'finished' | 'failed'
export type SocketMessageType = 'request' | 'resolve' | 'reject' | 'status'
export type AnyFunctionType = (...values: any[]) => any
export type PoolEvents = {
    'worker-error': [worker: WorkerInfo, error: any]
    'worker-exit': [worker: WorkerInfo, code: number]
    'worker-message': [worker: WorkerInfo, value: any]
    'worker-messageerror': [worker: WorkerInfo, error: any]
    'worker-online': [worker: WorkerInfo]
    'worker-locked': [worker: WorkerInfo]
    'worker-unlocked': [worker: WorkerInfo]
    'worker-removed': [worker: WorkerInfo]
    'terminate': [],
}
export type PoolEventKeys = keyof PoolEvents

export type WorkerEvents = {
    'ready': [],
    'idle': [],
    'lock': [],
    'unlock': [],
    'finish-run': []
    'terminate': []
}

export interface WorkerDictionary {
    [workerId: string]: WorkerImp
}

export interface WorkerInfo {
    id: string
    status: WorkerStatus
    runningTasks: number
    isLocked: boolean
}

export interface TaskInfo {
    id: string
    status: TaskStatus
    workerId?: string
    payload: any
    args: TaskArgs
    retries: number
}

export interface TaskArgs {
    env?: Partial<NodeJS.ProcessEnv>
    updateEnvStrategy?: UpdateEnvStrategy
    autoUpdateEnv?: boolean
    fileName?: string | URL
    functionName?: string
    moduleUrl?: string
    messagePorts?: Record<string, MessagePort>
}

export interface FunctionArgs<TPayload = any, TPorts extends Record<string, MessagePort> = Record<string, MessagePort>> {
    payload: TPayload
    messagePorts?: TPorts
}

export interface TaskPromiseEntries {
    taskId: string
    getWorkerId(): Promise<string>
}

export interface TaskPromise<T = void> extends Promise<T>, TaskPromiseEntries { }

export interface SocketMessage {
    type: SocketMessageType
    payload?: any,
    port?: MessagePort
}

export interface WorkerMessage {
    taskId: string
    workerChain: string[]
    env?: Partial<NodeJS.ProcessEnv>
    updateenvstrategy?: UpdateEnvStrategy
    payload?: any
    fileUrl?: string
    functionName?: string
    messagePorts?: Record<string, MessagePort>
}

export namespace GlobalPool {
    export type MessageType = 'run-task' | 'get-worker-id' | 'add-listener' | 'remove-listener' | 'emit-message'

    export interface PoolMessage {
        poolName: string
        type: MessageType
        payload: any
    }

    export interface RunTaskMessage {
        workerChain: string[]
        taskId: string
        args: TaskArgs
        payload?: any
    }

    export interface GetWorkerIdMessage {
        taskId: string
    }

    export interface AddListenerMessage {
        eventName: string
    }

    export interface RemoveListenerMessage {
        eventName: string
    }

    export interface EmitMessage {
        eventName: string
        args: any[]
    }
    export interface ListenersMap {
        [workerId: string]: {
            [eventName: string]: AnyFunctionType
        }
    }
}

export type WorkerData = null | {
    workerId: string
    socketPort: MessagePort,
    globalPoolPort: MessagePort
    disableLogs: boolean
}

export interface TaskContext {
    taskId: string
    workerChain: string[]
}

export interface MessageReceiverOptions {
    disableLogs?: boolean
}

export interface WorkerPoolOptions {
    poolName?: string
    minWorkers?: number
    maxWorkers?: number
    globalPool?: boolean
    fileName?: string | URL
    moduleUrl?: string
    idleTimeout?: number
    env?: Partial<NodeJS.ProcessEnv>
    autoUpdateEnv?: boolean
    updateEnvStrategy?: UpdateEnvStrategy
    maxListeners?: number
}
