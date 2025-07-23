import { MessageChannel, MessagePort, Transferable, Worker } from "worker_threads";
import { PromiseHandler } from "./PromiseHandler";
import { SocketMessage } from "./Types";


export class SocketMessageSender {
    constructor(private port: Worker | MessagePort) {
    }

    async status() {
        const channel = new MessageChannel()

        try {
            const message: SocketMessage = {
                type: 'status',
                port: channel.port2
            }

            const ph = new PromiseHandler<boolean>()
            this.waitResponse(ph, channel.port1)

            this.port.postMessage(message, [channel.port2])

            return await ph.promise
        } finally {
            channel.port1.close()
            channel.port2.close()
        }
    }

    async request<T>(payload: any, transferList?: readonly Transferable[]) {
        const channel = new MessageChannel()

        try {
            const message: SocketMessage = {
                type: 'request',
                payload: payload,
                port: channel.port2
            }

            const ph = new PromiseHandler<T>()
            this.waitResponse(ph, channel.port1)

            const tl: Transferable[] = [channel.port2]
            if (transferList) {
                tl.push(...transferList)
            }

            this.port.postMessage(message, tl)

            return await ph.promise
        } finally {
            channel.port1.close()
            channel.port2.close()
        }
    }

    send(payload: any) {
        const message: SocketMessage = {
            type: 'request',
            payload: payload,
        }

        this.port.postMessage(message)
    }

    private waitResponse<T>(handler: PromiseHandler<T>, port: MessagePort) {
        const closeHandler = () => {
            this.port.off('error', errorHandler)
            this.port.off('close', closeHandler)
            this.port.off('exit', exitHandler)
            this.port.off('message', messageHandler)

            handler.reject(new Error(`The message port was closed.`))
        }

        const errorHandler = (err: any) => {
            this.port.off('error', errorHandler)
            this.port.off('close', closeHandler)
            this.port.off('exit', exitHandler)
            this.port.off('message', messageHandler)

            handler.reject(err);
        };

        const exitHandler = (code: number) => {
            this.port.off('error', errorHandler)
            this.port.off('close', closeHandler)
            this.port.off('exit', exitHandler)
            this.port.off('message', messageHandler)

            handler.reject(new Error(`The worker exited with status code ${code}.`))
        }

        if (this.port instanceof MessagePort) {
            this.port.once('close', closeHandler)
        } else {
            this.port.once('error', errorHandler)
            this.port.once('exit', exitHandler)
        }

        const messageHandler = (value: SocketMessage) => {
            this.port.off('error', errorHandler)
            this.port.off('close', closeHandler)
            this.port.off('exit', exitHandler)
            this.port.off('message', messageHandler)

            if (value.type == 'resolve') {
                handler.resolve(value.payload)
                return
            }

            handler.reject(value.payload)
        }
        port.once('message', messageHandler)
    }
}