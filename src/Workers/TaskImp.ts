import { PromiseHandler } from "./PromiseHandler"
import { TaskInfo, TaskArgs, TaskPromise } from "./Types"
import { WorkerImp } from "./WorkerImp"

export class TaskImp  {
    info: TaskInfo
    workerChain: string[]
    promise: TaskPromise<any> = null!
    taskPH: PromiseHandler<any>
    workerIdPH: PromiseHandler<string>

    constructor(id: string, param: any, args: TaskArgs, workerChain: string[]) {
        this.info = {
            id: id,
            status: 'queued',
            payload: param,
            args: args ?? {},
            retries: 0,
        }
        this.workerChain = workerChain
        this.taskPH = new PromiseHandler<any>()
        this.workerIdPH = new PromiseHandler<string>()

        this.createPromise()
    }

    private createPromise() {
        const workerIdPH = this.workerIdPH

        const promise = this.taskPH.promise
        Object.assign(promise, {
            taskId: this.info.id,
            async getWorkerId() {
                return await workerIdPH.promise
            }
        })

        this.promise = promise as any
    }

    private resolve(value: any) {
        this.taskPH.resolve(value)
        this.info.status = 'finished'
    }

    private reject(value: any) {
        this.taskPH.reject(value)
        this.info.status = 'failed'
    }

    async run(worker: WorkerImp) {
        this.workerIdPH.resolve(worker.info.id)

        try {
            this.info.status = 'running'
            const result = await worker.run(this)
            this.resolve(result)
        } catch (error) {
            this.reject(error)
        }
    }

    terminate() {
        this.taskPH.reject(new Error('Task was terminated'))
        this.workerIdPH.reject(new Error('Task was terminated'))
    }
}