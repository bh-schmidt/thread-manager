import EventEmitter from "events";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { isMainThread, MessageChannel, Transferable, Worker } from "worker_threads";
import { PromiseHandler } from "./PromiseHandler";
import { SocketMessageHandler } from "./SocketMessageHandler";
import { SocketMessageSender } from "./SocketMessageSender";
import { TaskImp } from "./TaskImp";
import { WorkerData, WorkerEvents, WorkerInfo, WorkerMessage } from "./Types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface WorkerOptions {
    globalPool: boolean
    idleTimeout?: number
    env?: Partial<NodeJS.ProcessEnv>
}

export class WorkerImp {
    readonly info: WorkerInfo
    instance?: Worker
    sender?: SocketMessageSender
    handler?: SocketMessageHandler;
    channel?: MessageChannel;
    globalPoolChannel?: MessageChannel
    startingPromise?: Promise<void>
    idleTimeoutId?: NodeJS.Timeout

    private _terminated = false
    private _emitter: EventEmitter<WorkerEvents>

    constructor(private options: WorkerOptions) {
        this.validate()

        this._emitter = new EventEmitter()
        this.info = {
            id: crypto.randomUUID(),
            status: 'created',
            runningTasks: 0,
            isLocked: false
        }
    }

    async start() {
        this.validate()

        if (this.info.status == 'starting') {
            throw new Error('The worker is already starting')
        }

        if (this.info.status == 'ready' || this.info.status == 'idle' || this.info.status == 'running') {
            throw new Error('The worker is already started')
        }

        if (this.info.status == 'closed') {
            throw new Error('The worker is already closed')
        }

        this.info.status = 'starting'

        const readyPh = new PromiseHandler()
        this.startingPromise = readyPh.promise

        this.channel = new MessageChannel()
        this.handler = new SocketMessageHandler(this.channel.port1)

        const transferList: Transferable[] = [this.channel.port2]
        if (this.options.globalPool && isMainThread) {
            this.globalPoolChannel = new MessageChannel()
            transferList.push(this.globalPoolChannel.port2)
        }

        this.handler.onStatus(() => {
            if (!readyPh.completed) {
                this.info.status = 'ready'
                this.safeEmit('ready')
                readyPh.resolve()
            }
        })

        const workerPath = join(__dirname, 'Worker.js')
        this.instance = new Worker(workerPath, {
            workerData: {
                workerId: this.info.id,
                socketPort: this.channel.port2,
                globalPoolPort: this.globalPoolChannel?.port2
            } as WorkerData,
            transferList: transferList,
            execArgv: [],
            env: this.options.env
        })

        this.instance.on('error', async (err) => {
            this.info.status = 'closed'

            if (!readyPh.completed) {
                readyPh.reject(err)
            }
        })

        this.instance.on('exit', async (code) => {
            this.info.status = 'closed'

            if (!readyPh.completed) {
                readyPh.reject(new Error(`Worker exited with code '${code}'.`))
            }

            await this.terminate()
                .catch((err) => {
                    console.error(err)
                })
        })

        this.sender = new SocketMessageSender(this.channel.port1)

        await readyPh.promise
    }

    async run(task: TaskImp) {
        this.validate()

        try {
            if (this.info.status == 'starting') {
                await this.startingPromise
            }

            if (this.info.status == 'created') {
                throw new Error(`The worker '${this.info.id}' was not started.`)
            }

            if (this.info.status == 'closed') {
                throw new Error(`The worker '${this.info.id}' was closed.`)
            }

            this.info.status = 'running'

            this.info.runningTasks++

            const msg: WorkerMessage = {
                taskId: task.info.id,
                workerChain: task.workerChain,
                env: task.info.args.env,
                updateenvstrategy: task.info.args.updateEnvStrategy,
                payload: task.info.payload,
                fileUrl: this.getFileUrl(task.info.args.fileName, task.info.args.moduleUrl),
                messagePorts: task.info.args.messagePorts,
                functionName: task.info.args.functionName
            }

            const transferList = task.info.args.messagePorts ?
                Object.values(task.info.args.messagePorts) :
                undefined

            const res = await this.sender!.request(msg, transferList);
            return res
        } finally {
            this.info.runningTasks--
            this.safeEmit('finish-run')
            // this.toggleStatus()
        }
    }

    lock() {
        this.validate()

        this.info.isLocked = true
        this.safeEmit('lock')
    }

    unlock() {
        this.info.isLocked = false
        this.safeEmit('unlock')
    }

    on(type: 'ready', callback: () => void): WorkerImp
    on(type: 'idle', callback: () => void): WorkerImp
    on(type: 'lock', callback: () => void): WorkerImp
    on(type: 'unlock', callback: () => void): WorkerImp
    on(type: 'finish-run', callback: () => void): WorkerImp
    on(type: 'terminate', callback: () => void): WorkerImp
    on(type: any, callback: (...args: any[]) => void) {
        this.validate()

        this._emitter.on(type, callback)
        return this
    }

    once(type: 'ready', callback: () => void): WorkerImp
    once(type: 'idle', callback: () => void): WorkerImp
    once(type: 'lock', callback: () => void): WorkerImp
    once(type: 'unlock', callback: () => void): WorkerImp
    once(type: 'finish-run', callback: () => void): WorkerImp
    once(type: 'terminate', callback: () => void): WorkerImp
    once(type: any, callback: (...args: any[]) => void) {
        this.validate()

        this._emitter.once(type, callback)
        return this
    }

    off(type: 'ready', callback: () => void): WorkerImp
    off(type: 'idle', callback: () => void): WorkerImp
    off(type: 'lock', callback: () => void): WorkerImp
    off(type: 'unlock', callback: () => void): WorkerImp
    off(type: 'finish-run', callback: () => void): WorkerImp
    off(type: 'terminate', callback: () => void): WorkerImp
    off(type: any, callback: (...args: any[]) => void) {
        this._emitter.off(type, callback)
        return this
    }

    // private toggleStatus() {
    //     if (this.info.status == 'closed')
    //         return

    //     if (this.info.runningTasks > 0)
    //         return

    //     this.info.status = 'ready'
    //     this.safeEmit('ready')

    //     let timeout = this.options.idleTimeout ?? 0
    //     timeout = Math.max(timeout, 0)

    //     clearTimeout(this._idleTimeoutId)

    //     this._idleTimeoutId = setTimeout(() => {
    //         if (this.info.status != 'ready') {
    //             return
    //         }

    //         this.info.status = 'idle'
    //         this.safeEmit
    //             ('idle')
    //     }, timeout);
    // }

    private getFileUrl(fileName: string | URL | undefined, moduleUrl: string | undefined): string {
        if (!fileName) {
            throw new Error('File is required.')
        }

        if (moduleUrl) {
            return new URL(fileName, moduleUrl).href
        }

        if (fileName instanceof URL) {
            return fileName.href
        }

        return pathToFileURL(fileName).href
    }

    async terminate() {
        if (this._terminated) {
            return
        }

        this._terminated = true
        this.info.status = 'closed'

        if (this.channel) {
            this.channel.port1.close()
            this.channel.port2.close()
            this.channel = undefined
        }

        if (this.globalPoolChannel) {
            this.globalPoolChannel.port1.close()
            this.globalPoolChannel.port2.close()
            this.globalPoolChannel = undefined
        }

        if (this.instance) {
            await this.instance?.terminate()
            this.instance = undefined
        }

        this.safeEmit('terminate')
        this._emitter.removeAllListeners()
    }

    private safeEmit<K extends keyof WorkerEvents>(eventName: K, ...args: WorkerEvents[K]) {
        try {
            this._emitter.emit(eventName as any, ...args)
        } catch (error) {
            console.error(error)
        }
    }

    private validate() {
        if (this._terminated) {
            throw new Error('Worker is terminated.')
        }

        if (this.options.globalPool && !isMainThread) {
            throw new Error('You can only instance a new worker using global pool in main thread.')
        }
    }
}