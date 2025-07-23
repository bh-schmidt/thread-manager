import { MessagePort } from "worker_threads";
import { MessageReceiverOptions, SocketMessage } from "./Types";

export class SocketMessageHandler {
    private _onStatus: () => void | Promise<void>
    private _onRequest: (value: any) => any
    private _onClose: () => void | Promise<void>
    private _onMessageHandler: (message: SocketMessage) => Promise<void>;
    private _onCloseListener: () => Promise<void>;

    constructor(private port: MessagePort, private options: MessageReceiverOptions = {}) {
        this._onStatus = () => { }
        this._onRequest = () => { }
        this._onClose = () => { }

        this._onMessageHandler = async (message: SocketMessage) => {
            try {
                if (message.type == 'status') {
                    const response: SocketMessage = {
                        type: 'resolve',
                        payload: true
                    }

                    await this._onStatus()
                    message.port?.postMessage(response)
                    return
                }

                const result = await this._onRequest(message.payload)

                if (message.port) {
                    const response: SocketMessage = {
                        type: 'resolve',
                        payload: result
                    }

                    message.port.postMessage(response)
                }
            } catch (error) {
                if (message.port) {
                    const response: SocketMessage = {
                        type: 'reject',
                        payload: error
                    }

                    message.port.postMessage(response)
                    return
                }

                if (!this.options.disableLogs) {
                    console.error(error)
                }
            }
        }

        this._onCloseListener = async () => {
            try {
                await this._onClose()
            } catch (error) {
                if (!this.options.disableLogs) {
                    console.error(error)
                }
            }
        }

        this.port.on('message', this._onMessageHandler)
        this.port.on('close', this._onCloseListener)
    }

    onStatus(handler: () => void | Promise<void>) {
        this._onStatus = handler
    }

    onRequest(handler: (value: any) => any) {
        this._onRequest = handler
    }

    onClose(handler: () => void | Promise<void>) {
        this._onClose = handler
    }
}