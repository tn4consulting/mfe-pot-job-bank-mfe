import '@testing-library/jest-dom';

// jsdom's test environment has no TextEncoder/TextDecoder global (unlike a
// real browser or plain Node) -- @opentelemetry/instrumentation-fetch
// references TextEncoder at module-eval time (not just when actually
// instrumenting), so any test that imports @tn4consulting/shared-
// observability (even just for withRemoteParent, not
// initBrowserObservability itself) crashes with "TextEncoder is not
// defined" without this. Node's own util module has real implementations.
import { TextDecoder, TextEncoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
