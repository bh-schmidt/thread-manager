import EventEmitter from "events";
import { availableParallelism } from "os";
import { isMainThread, workerData } from "worker_threads";
import { ExecutionContext } from "./ExecutionContext";
import { PromiseHandler } from "./PromiseHandler";
import { SocketMessageHandler } from "./SocketMessageHandler";
import { SocketMessageSender } from "./SocketMessageSender";
import { TaskImp } from "./TaskImp";
import { GlobalPool, PoolEvents, TaskArgs, TaskContext, TaskInfo, TaskPromise, TaskPromiseEntries, WorkerData, WorkerDictionary, WorkerInfo, WorkerPoolOptions } from "./Types";
import { WorkerImp } from "./WorkerImp";

/**
 * List of all instanced pools. 
 * 
 * A pool will automatically be added and removed in this list when instanced or terminated.
 */
export const instancedPools: WorkerPool[] = []
/**
 * Dictionary of all global pools.
 * 
 * A pool will automatically be added and removed in this list when instanced or terminated.
 */
export const globalPools: Record<string, WorkerPool> = {}
const wd = workerData as WorkerData

export class WorkerPool {
    options: WorkerPoolOptions
    private queue: TaskImp[]
    private workersDic: WorkerDictionary
    private workers: WorkerImp[]
    private tasks: Record<string, TaskImp>

    private _terminated: boolean;
    private _queueRunning = false

    get terminated() {
        return this._terminated
    }

    private _globalPoolMessageHandler?: SocketMessageHandler;
    private _globalPoolMessageSender?: SocketMessageSender;
    private _globalPoolListeners?: GlobalPool.ListenersMap

    private _emitter: EventEmitter<PoolEvents>

    constructor(options?: WorkerPoolOptions) {
        options = {
            ...options
        }

        options.idleTimeout ??= 100
        options.poolName ??= 'default'
        options.minWorkers ??= 0
        options.maxWorkers ??= availableParallelism() * 2
        options.globalPool ??= false
        options.updateEnvStrategy ??= 'deep-merge'
        options.autoUpdateEnv ??= false

        this.tasks = {}
        this.queue = []
        this.workersDic = {}
        this.workers = []
        this._emitter = new EventEmitter()
        if (options.maxListeners) {
            this._emitter.setMaxListeners(options.maxListeners)
        }

        this._terminated = false

        this.options = options

        if (options.globalPool && options.poolName in globalPools) {
            throw new Error(`There already is a global pool with name '${options.poolName}' instanced.`)
        }

        if (options.maxWorkers! < options.minWorkers!) {
            throw new Error(`'minWorkers' should be smaller than or equal to 'maxWorkers'.`)
        }

        if (options.maxWorkers! < 1) {
            throw new Error(`'maxWorkers' should be greater than '0'.`)
        }

        if (options.globalPool) {
            globalPools[options.poolName] = this
        }

        if (options.globalPool) {
            if (isMainThread) {
                this._globalPoolListeners = {}
            } else {
                if (!wd?.globalPoolPort) {
                    throw new Error(`The 'mainThreadPort' is missing from 'workerData'. This is possibly because this worker was not started by WorkerPool.`)
                }

                this._globalPoolMessageSender = new SocketMessageSender(wd.globalPoolPort)
                this._globalPoolMessageHandler = new SocketMessageHandler(wd.globalPoolPort)

                this._globalPoolMessageHandler.onRequest((poolMessage: GlobalPool.PoolMessage) => {
                    if (poolMessage.type == 'emit-message') {
                        const message = poolMessage.payload as GlobalPool.EmitMessage
                        this.safeEmit(message.eventName as any, ...message.args)

                        if (this._emitter.listenerCount(message.eventName) > 0) {
                            return
                        }

                        const offMessage: GlobalPool.RemoveListenerMessage = {
                            eventName: message.eventName
                        }

                        const callbackMessage: GlobalPool.PoolMessage = {
                            payload: offMessage,
                            poolName: options.poolName!,
                            type: 'remove-listener'
                        }

                        this._globalPoolMessageSender!.send(callbackMessage)
                    }
                })
            }
        }

        instancedPools.push(this)
    }

    async getQueue(): Promise<TaskInfo[]> {
        // this shall be async because in the future it will be able to get workers inside a worker
        const infos = this.queue.map(e => e.info)
        return structuredClone(infos)
    }

    async getWorkers(): Promise<WorkerInfo[]> {
        // this shall be async because in the future it will be able to get workers inside a worker
        const w = Object.values(this.workersDic)
        const infos = w.map(e => e.info)
        return structuredClone(infos)
    }

    run<T = unknown>(payload?: any, args: TaskArgs = {}): TaskPromise<T> {
        this.validatePool()
        const taskId = crypto.randomUUID()

        if (!isMainThread && this.options.globalPool) {
            return this.sendTaskToMainThread<T>(payload, args, taskId)
        }

        return this.runTask(payload, args, taskId, []);
    }

    async ensureWorkers() {
        this.validatePool()
        if (this.options.globalPool && !isMainThread) {
            throw new Error(`'ensureWorkers' only works on main thread when using 'globalPool'.`)
        }

        this.ensureMinimumWorkers()

        while (true) {
            const worker = this.workers.find(e => e.info.status == 'created')

            if (!worker) {
                break
            }

            await this.startWorker(worker)
        }
    }

    private runTask(payload: any, args: TaskArgs, taskId: string, workerChain: string[]) {
        if (args.moduleUrl && !args.fileName) {
            throw new Error(`'fileName' is required when using 'moduleUrl'.`);
        }

        if (workerChain.length >= this.options.maxWorkers!) {
            throw new Error(`The worker chain for this task achieved the maximum size (${this.options.maxWorkers!}), which is the maximum quantity of workers.`)
        }

        if (!args.fileName) {
            args.fileName = this.options.fileName;
            args.moduleUrl = this.options.moduleUrl;
        }

        args.updateEnvStrategy ??= this.options.updateEnvStrategy

        if (args.env || args.autoUpdateEnv || this.options.autoUpdateEnv) {
            if (args.updateEnvStrategy == 'replace') {
                args.env = {
                    ...this.options.env,
                    ...args.env
                }
            } else {
                args.env = {
                    ...process.env,
                    ...this.options.env,
                    ...args.env
                };
            }
        }

        const task = new TaskImp(taskId, payload, args, workerChain);
        this.queue.push(task);
        this.tasks[taskId] = task;

        this.runWorker()
        // this.runQueue()

        return task.promise;
    }

    private async runWorker() {
        if (this.options.globalPool && !isMainThread) {
            throw new Error(`'runWorker' only works on main thread when using 'globalPool'.`)
        }

        if (this.queue.length == 0) {
            return
        }

        if (this.workers.length == this.options.maxWorkers) {
            return
        }

        const worker = this.getLockedWorkerNew()
        if (!worker) {
            return
        }

        clearTimeout(worker.idleTimeoutId)

        try {
            if (worker.info.status == 'created') {
                await this.startWorker(worker)
            }

            if (worker.info.status == 'starting') {
                await worker.startingPromise
            }
        } catch (error) {
            if (!this._terminated) {
                console.error(error)
            }

            worker.unlock()
            return
        }

        if (worker.info.status == 'closed') {
            console.error('The worker is closed.')
            worker.unlock()
            return
        }

        while (this.queue.length > 0 && worker?.info.status as any != 'closed') {
            const task = this.queue.shift()

            try {
                await task?.run(worker)
            } catch (error) {
                console.error(error)
                return
            }
        }

        worker.unlock()

        worker.idleTimeoutId = setTimeout(async () => {
            await this.removeIdleWorker(worker)
        }, this.options.idleTimeout);
    }

    private async runQueue() {
        if (this.options.globalPool && !isMainThread) {
            throw new Error(`'runQueue' only works on main thread when using 'globalPool'.`)
        }

        if (this._queueRunning)
            return

        this._queueRunning = true
        const maximumRetries = 3

        this.ensureMinimumWorkers()

        while (this.queue.length > 0) {
            if (this._terminated) {
                break
            }

            const task = this.queue.shift() as TaskImp
            if (task.taskPH.completed) {
                continue
            }

            let worker: WorkerImp = null!

            try {
                worker = await this.getLockedWorker(task.info.id, task.workerChain)

                if (worker.info.status == 'created') {
                    await this.startWorker(worker)
                }

                if (worker.info.status == 'closed') {
                    throw new Error('The worker is closed.')
                }
            } catch (error) {
                if (this._terminated) {
                    task.taskPH.reject(error)
                    break
                }

                worker.unlock()

                if (task.info.retries < maximumRetries) {
                    task.info.retries++
                    this.queue.unshift(task)
                    continue
                }

                task.taskPH.reject(error)
                continue
            }

            task.run(worker)
                .finally(() => {
                    worker.unlock()
                })
        }

        this._queueRunning = false
    }

    private sendTaskToMainThread<T = unknown>(payload: any, args: TaskArgs, taskId: string): TaskPromise<T> {
        if (!this._globalPoolMessageSender) {
            throw new Error(`The '_globalPoolMessageSender' was not instanced.`)
        }

        const context = ExecutionContext.getStore<TaskContext>()
        const taskMessage: GlobalPool.RunTaskMessage = {
            taskId: taskId,
            args: args,
            payload: payload,
            workerChain: [
                ...context.workerChain,
                wd!.workerId
            ],
        }

        const message: GlobalPool.PoolMessage = {
            type: 'run-task',
            poolName: this.options.poolName!,
            payload: taskMessage
        }

        const transferList = args.messagePorts ?
            Object.values(args.messagePorts) :
            undefined

        const prom = this._globalPoolMessageSender.request(message, transferList)
        const entries: TaskPromiseEntries = {
            taskId: taskId,
            getWorkerId: async () => {
                const workerIdMessage: GlobalPool.GetWorkerIdMessage = {
                    taskId: taskId
                }

                const message: GlobalPool.PoolMessage = {
                    type: 'get-worker-id',
                    poolName: this.options.poolName!,
                    payload: workerIdMessage
                }

                return await this._globalPoolMessageSender!.request(message)
            },
        }

        Object.assign(prom, entries)

        return prom as TaskPromise<T>
    }

    private ensureMinimumWorkers() {
        if (this.options.globalPool && !isMainThread) {
            throw new Error(`'createWorkers' only works on main thread when using 'globalPool'.`)
        }

        const minWorkers = this.options.minWorkers! - this.workers.length
        if (minWorkers > 0) {
            for (let index = 0; index < minWorkers; index++) {
                this.createWorker()
            }
        }
    }

    private async getLockedWorker(taskId: string, workerChain: string[]): Promise<WorkerImp> {
        const workerChainSet = new Set(workerChain)
        const suitableWorkers = this.workers.filter(w => w.info.status != 'closed' && !workerChainSet.has(w.info.id))

        if (suitableWorkers.length == 0) {
            if (this.workers.length == this.options.maxWorkers!) {
                throw new Error(`Couldn't find a worker to run the task '${taskId}'. It is possibly because of the size of the worker chain.`)
            }

            const worker = this.createWorker()
            worker.lock()
            return worker
        }

        if (suitableWorkers.every(e => e.info.isLocked)) {
            if (this.workers.length == this.options.maxWorkers!) {
                const ph = new PromiseHandler<WorkerImp>()

                const unlockedHandler = (info: WorkerInfo): void => {
                    const w = this.workersDic[info.id]
                    ph.resolve(w);
                };

                const terminateHandler = () => {
                    ph.reject(new Error('The pool was terminated.'));
                };

                this._emitter.on('worker-unlocked', unlockedHandler)
                this._emitter.on('terminate', terminateHandler)

                const worker = await ph.promise

                worker.lock()

                this.off('worker-unlocked', unlockedHandler)
                this.off('terminate', terminateHandler)

                return worker
            }

            const worker = this.createWorker()
            worker.lock()
            return worker
        }

        const worker = suitableWorkers.find(e => !e.info.isLocked) as WorkerImp
        if (!worker) {
            throw new Error(`Couldn't find a worker to run the task '${taskId}'. It is possibly because of the size of the worker chain.`)
        }

        worker.lock()

        return worker
    }

    private getLockedWorkerNew(): WorkerImp | undefined {
        this.ensureMinimumWorkers()

        let worker = this.workers.find(w => w.info.status != 'closed' && !w.info.isLocked)

        if (worker) {
            worker.lock()
            return worker
        }

        if (this.workers.length < this.options.maxWorkers!) {
            const worker = this.createWorker()
            worker.lock()
            return worker
        }

        return undefined
    }

    private async removeIdleWorker(worker: WorkerImp) {
        if (this.options.globalPool && !isMainThread) {
            throw new Error(`'removeIdleWorker' only works on main thread when using 'globalPool'.`)
        }

        if (worker.info.isLocked) {
            return
        }

        if (this.options.minWorkers! >= this.workers.length) {
            return
        }

        await this.removeWorker(worker)
    }

    private async removeWorker(worker: WorkerImp) {
        if (this.options.globalPool && !isMainThread) {
            throw new Error(`'removeWorker' only works on main thread when using 'globalPool'.`)
        }

        if (!this.workers.includes(worker)) {
            return
        }

        const index = this.workers.indexOf(worker)
        this.workers.splice(index, 1)

        if (isMainThread && this.options.globalPool) {
            if (this._globalPoolListeners?.[worker.info.id]) {
                const entries = Object.entries(this._globalPoolListeners[worker.info.id])
                for (const [eventName, handler] of entries) {
                    this._emitter.off(eventName as any, handler)
                }
            }
        }

        try {
            await worker.terminate()
            delete this.workersDic[worker.info.id]
            this.safeEmit('worker-removed', worker.info)
        } catch (error) {
            this.workers.push(worker)
            throw error
        }
    }

    private async startWorker(worker: WorkerImp) {
        if (this.options.globalPool && !isMainThread) {
            throw new Error(`'startWorker' only works on main thread when using 'globalPool'.`)
        }

        await worker.start()

        worker.instance?.on('error', async (err) => {
            this.safeEmit('worker-error', worker.info, err)
        })

        worker.instance?.on('exit', async (code) => {
            this.safeEmit('worker-exit', worker.info, code)

            if (this._terminated) {
                return
            }

            await this.removeWorker(worker)

            this.ensureMinimumWorkers()
            this.ensureWorkers()
            if (this.workers.length < this.options.minWorkers!) {

            }

            if (this.queue.length == 0) {
                return
            }

            if (this.workers.length >= this.options.maxWorkers!) {
                return
            }

            const unlockedWorkers = this.workers.filter(e => !e.info.isLocked)
            if (unlockedWorkers.length > 0) {
                return
            }

            const w = this.createWorker()

            await this.startWorker(w)
                .catch(err => {
                    console.error(err)
                })

            this.runWorker()
        })

        worker.instance?.on('message', (value) => {
            this.safeEmit('worker-message', worker.info, value)
        })

        worker.instance?.on('messageerror', (error) => {
            this.safeEmit('worker-messageerror', worker.info, error)
        })

        worker.instance?.on('online', () => {
            this.safeEmit('worker-online', worker.info)
        })

        worker.on('unlock', () => {
            this.safeEmit('worker-unlocked', worker.info)
        })

        // worker.on('idle', async () => {
        //     await this.removeIdleWorker(worker)
        // })

        if (isMainThread && this.options.globalPool) {
            if (!worker.globalPoolChannel) {
                throw new Error('Global pool channel was not started.')
            }

            this._globalPoolListeners ??= {}
            const globalPoolMessageHandler = new SocketMessageHandler(worker.globalPoolChannel.port1)
            const globalPoolMessageSender = new SocketMessageSender(worker.globalPoolChannel.port1)

            globalPoolMessageHandler.onRequest(async (poolMessage: GlobalPool.PoolMessage) => {
                if (poolMessage.type == 'run-task') {
                    const taskMessage = poolMessage.payload as GlobalPool.RunTaskMessage

                    const pool = globalPools[this.options.poolName!]
                    if (!pool) {
                        throw new Error(`The pool '${this.options.poolName}' does not exist or is not instantiated on main thread. Ensure it is created on the main thread.`)
                    }

                    return await pool.runTask(taskMessage.payload, taskMessage.args, taskMessage.taskId, taskMessage.workerChain)
                }

                if (poolMessage.type == 'get-worker-id') {
                    const m = poolMessage.payload as GlobalPool.GetWorkerIdMessage
                    const task = this.tasks[m.taskId]

                    if (!task) {
                        throw new Error(`Task with id '${m.taskId}' does not exist or was already completed.`)
                    }

                    return await task.workerIdPH.promise
                }

                if (poolMessage.type == 'add-listener') {
                    if (this._globalPoolListeners![worker.info.id]) {
                        return
                    }

                    if (!worker.globalPoolChannel) {
                        throw new Error(`Worker's globalPoolChannel was not created.`)
                    }

                    if (!this._globalPoolListeners) {
                        throw new Error('_globalPoolListeners was not instanced')
                    }

                    const message = poolMessage.payload as GlobalPool.AddListenerMessage

                    this._globalPoolListeners[worker.info.id] ??= {}
                    this._globalPoolListeners[worker.info.id][message.eventName] = (...values: any[]) => {
                        const emitMessage: GlobalPool.EmitMessage = {
                            eventName: message.eventName,
                            args: values
                        }

                        const poolMessage: GlobalPool.PoolMessage = {
                            poolName: this.options.poolName!,
                            payload: emitMessage,
                            type: 'emit-message'
                        }

                        if (worker.info.status != 'closed') {
                            globalPoolMessageSender.send(poolMessage)
                        }
                    }

                    this._emitter.on(message.eventName as any, this._globalPoolListeners[worker.info.id][message.eventName])
                }

                if (poolMessage.type == 'remove-listener') {
                    const message = poolMessage.payload as GlobalPool.RemoveListenerMessage
                    if (!this._globalPoolListeners?.[worker.info.id]?.[message.eventName]) {
                        return
                    }

                    this._emitter.off(message.eventName as any, this._globalPoolListeners[worker.info.id][message.eventName])
                    delete this._globalPoolListeners[worker.info.id][message.eventName]

                    if (Object.keys(this._globalPoolListeners[worker.info.id]).length == 0) {
                        delete this._globalPoolListeners[worker.info.id]
                    }
                }
            })
        }
    }

    private createWorker() {
        if (this.options.globalPool && !isMainThread) {
            throw new Error(`'createWorker' only works on main thread when using 'globalPool'.`)
        }

        const env = this.options.updateEnvStrategy == 'replace' ?
            {
                ...this.options.env
            } :
            {
                ...process.env,
                ...this.options.env
            }

        const worker = new WorkerImp({
            idleTimeout: this.options.idleTimeout,
            globalPool: this.options.globalPool!,
            env: env
        })

        this.workers.push(worker)
        this.workersDic[worker.info.id] = worker

        return worker
    }

    listenerCount(eventName: 'error', callback?: (worker: WorkerInfo, error: any) => void): number
    listenerCount(eventName: 'exit', callback?: (worker: WorkerInfo, code: number) => void): number
    listenerCount(eventName: 'message', callback?: (worker: WorkerInfo, value: any) => void): number
    listenerCount(eventName: 'messageerror', callback?: (worker: WorkerInfo, error: any) => void): number
    listenerCount(eventName: 'online', callback?: (worker: WorkerInfo) => void): number
    listenerCount(eventName: 'worker-ready', callback?: (worker: WorkerInfo) => void): number
    listenerCount(eventName: 'worker-idle', callback?: (worker: WorkerInfo) => void): number
    listenerCount(eventName: 'worker-unlocked', callback?: (worker: WorkerInfo) => void): number
    listenerCount(eventName: 'worker-removed', callback?: (worker: WorkerInfo) => void): number
    listenerCount(eventName: 'terminate', callback?: (worker: WorkerInfo) => void): number
    listenerCount(eventName: any, callback?: (...args: any[]) => void) {
        return this._emitter.listenerCount(eventName, callback)
    }

    on(eventName: 'error', callback: (worker: WorkerInfo, error: any) => void): WorkerPool
    on(eventName: 'exit', callback: (worker: WorkerInfo, code: number) => void): WorkerPool
    on(eventName: 'message', callback: (worker: WorkerInfo, value: any) => void): WorkerPool
    on(eventName: 'messageerror', callback: (worker: WorkerInfo, error: any) => void): WorkerPool
    on(eventName: 'online', callback: (worker: WorkerInfo) => void): WorkerPool
    on(eventName: 'worker-ready', callback: (worker: WorkerInfo) => void): WorkerPool
    on(eventName: 'worker-idle', callback: (worker: WorkerInfo) => void): WorkerPool
    on(eventName: 'worker-unlocked', callback: (worker: WorkerInfo) => void): WorkerPool
    on(eventName: 'worker-removed', callback: (worker: WorkerInfo) => void): WorkerPool
    on(eventName: 'terminate', callback: (worker: WorkerInfo) => void): WorkerPool
    on(eventName: any, callback: (...args: any[]) => void) {
        if (this.options.globalPool && !isMainThread) {
            if (!this._globalPoolMessageSender) {
                throw new Error('_globalPoolMessageSender was not instanced.')
            }

            this._emitter.on(eventName, callback)

            if (this._emitter.listenerCount(eventName) > 1) {
                return this
            }

            const message: GlobalPool.RemoveListenerMessage = {
                eventName: eventName
            }

            const poolMessage: GlobalPool.PoolMessage = {
                payload: message,
                poolName: this.options.poolName!,
                type: 'add-listener'
            }

            this._globalPoolMessageSender.send(poolMessage)

            return this
        }

        this.validatePool()
        this._emitter.on(eventName, callback)
        return this
    }

    once(eventName: 'error', callback: (worker: WorkerInfo, error: any) => void): WorkerPool
    once(eventName: 'exit', callback: (worker: WorkerInfo, code: number) => void): WorkerPool
    once(eventName: 'message', callback: (worker: WorkerInfo, value: any) => void): WorkerPool
    once(eventName: 'messageerror', callback: (worker: WorkerInfo, error: any) => void): WorkerPool
    once(eventName: 'online', callback: (worker: WorkerInfo) => void): WorkerPool
    once(eventName: 'worker-ready', callback: (worker: WorkerInfo) => void): WorkerPool
    once(eventName: 'worker-idle', callback: (worker: WorkerInfo) => void): WorkerPool
    once(eventName: 'worker-unlocked', callback: (worker: WorkerInfo) => void): WorkerPool
    once(eventName: 'worker-removed', callback: (worker: WorkerInfo) => void): WorkerPool
    once(eventName: 'terminate', callback: (worker: WorkerInfo) => void): WorkerPool
    once(eventName: any, callback: (...args: any[]) => void) {
        this.validatePool()

        if (this.options.globalPool && !isMainThread) {
            if (!this._globalPoolMessageSender) {
                throw new Error('_globalPoolMessageSender was not instanced.')
            }

            this._emitter.once(eventName, callback)

            if (this._emitter.listenerCount(eventName) > 1) {
                return this
            }

            const message: GlobalPool.RemoveListenerMessage = {
                eventName: eventName
            }

            const poolMessage: GlobalPool.PoolMessage = {
                payload: message,
                poolName: this.options.poolName!,
                type: 'add-listener'
            }

            this._globalPoolMessageSender.send(poolMessage)

            return this
        }

        this._emitter.once(eventName, callback)
        return this
    }

    off(eventName: 'error', callback: (worker: WorkerInfo, error: any) => void): WorkerPool
    off(eventName: 'exit', callback: (worker: WorkerInfo, code: number) => void): WorkerPool
    off(eventName: 'message', callback: (worker: WorkerInfo, value: any) => void): WorkerPool
    off(eventName: 'messageerror', callback: (worker: WorkerInfo, error: any) => void): WorkerPool
    off(eventName: 'online', callback: (worker: WorkerInfo) => void): WorkerPool
    off(eventName: 'worker-ready', callback: (worker: WorkerInfo) => void): WorkerPool
    off(eventName: 'worker-idle', callback: (worker: WorkerInfo) => void): WorkerPool
    off(eventName: 'worker-unlocked', callback: (worker: WorkerInfo) => void): WorkerPool
    off(eventName: 'worker-removed', callback: (worker: WorkerInfo) => void): WorkerPool
    off(eventName: 'terminate', callback: (worker: WorkerInfo) => void): WorkerPool
    off(eventName: any, callback: (...args: any[]) => void) {
        this.validatePool()

        if (this.options.globalPool && !isMainThread) {
            if (!this._globalPoolMessageSender) {
                throw new Error('_globalPoolMessageSender was not instanced.')
            }

            this._emitter.off(eventName, callback)

            if (this._emitter.listenerCount(eventName) > 0) {
                return this
            }

            const message: GlobalPool.RemoveListenerMessage = {
                eventName: eventName
            }

            const poolMessage: GlobalPool.PoolMessage = {
                payload: message,
                poolName: this.options.poolName!,
                type: 'remove-listener'
            }

            this._globalPoolMessageSender.send(poolMessage)

            return this
        }

        this._emitter.off(eventName, callback)
        return this
    }

    private safeEmit<K extends keyof PoolEvents>(eventName: K, ...args: PoolEvents[K]) {
        try {
            this._emitter.emit(eventName as any, ...args)
        } catch (error) {
            console.error(error)
        }
    }

    private validatePool() {
        if (this._terminated) {
            throw new Error('The pool was terminated.')
        }
    }

    async terminate() {
        if (this.terminated) {
            return
        }

        this._terminated = true

        for (const task of this.queue as TaskImp[]) {
            task.terminate()
        }
        this.queue = []


        if (this.options.globalPool) {
            delete globalPools[this.options.poolName!]
        }

        const poolIndex = instancedPools.indexOf(this);
        if (poolIndex != -1) {
            instancedPools.slice(poolIndex, 1)
        }

        const proms = this.workers.map(e => e.terminate())
        await Promise.all(proms)
        this.workers = []
        this.workersDic = {}

        this.safeEmit('terminate')
        this._emitter.removeAllListeners()
    }
}