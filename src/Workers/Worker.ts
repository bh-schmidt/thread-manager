import { workerData } from "worker_threads";
import { SocketMessageHandler } from "./SocketMessageHandler";
import { FunctionArgs, SocketMessage, TaskContext, WorkerData, WorkerMessage } from "./Types";
import { ExecutionContext } from "./ExecutionContext";

const wd: WorkerData = workerData
const socket = new SocketMessageHandler(wd!.socketPort)

socket.onRequest(async (message: WorkerMessage) => {
    if (message.env) {
        if (message.updateenvstrategy == 'deep-merge') {
            Object.assign(process.env, message.env);
        } else {
            const newEnv = message.env as Record<string, string>;

            for (const key of Object.keys(process.env)) {
                if (!(key in newEnv)) delete process.env[key];
            }

            Object.assign(process.env, newEnv);
        }
    }

    const module = await import(message.fileUrl!)

    const handler = getHandler(message, module)
    if (typeof handler !== 'function') {
        if (message.functionName) {
            throw new Error(`Imported module '${message.fileUrl}' has no exported function with name '${message.functionName}'.`)
        }
        else {
            throw new Error(`Imported module '${message.fileUrl}' has no default function exported.`)
        }
    }

    const context: TaskContext = {
        taskId: message.taskId,
        workerChain: message.workerChain
    }

    return await ExecutionContext.run(context, async () => {
        const args: FunctionArgs = {
            payload: message.payload,
            messagePorts: message.messagePorts
        }

        return await handler(args)
    })
})

function getHandler(message: WorkerMessage, module: any) {
    if (!module) {
        throw new Error(`Couldn't import module '${message.fileUrl}'.`)
    }

    if (message.functionName) {
        return module[message.functionName]
    }

    if (module['default']) {
        return module['default']
    }

    return module
}

const message: SocketMessage = {
    type: 'status',
    payload: true,
}
wd!.socketPort.postMessage(message)