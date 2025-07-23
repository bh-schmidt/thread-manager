import inspector from 'inspector';
import { createDefaultEsmPreset, JestConfigWithTsJest } from 'ts-jest';

const preset = createDefaultEsmPreset({
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                useESM: true, // Explicitly enable ESM in ts-jest
            },
        ],
    },
})

const debug = inspector.url() !== undefined;

const config: JestConfigWithTsJest = {
    ...preset,
    testEnvironment: "node",
    extensionsToTreatAsEsm: ['.ts'],
    testTimeout: debug ? 60 * 60 * 1000 : 5000,
}

export default config;