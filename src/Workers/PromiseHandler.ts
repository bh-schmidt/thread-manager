export class PromiseHandler<T = void> {
    promise: Promise<T>
    resolve: (value: T) => void = null!
    reject: (reason: any) => void = null!
    completed: boolean = false

    constructor() {
        this.promise = new Promise((res, rej) => {
            this.resolve = (reason) => {
                if (this.completed)
                    return

                this.completed = true
                res(reason)
            }

            this.reject = (value) => {
                if (this.completed)
                    return

                this.completed = true
                rej(value)
            }
        })
    }
}