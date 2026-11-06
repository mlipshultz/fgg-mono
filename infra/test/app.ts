import { App } from 'aws-cdk-lib';

/**
 * A CDK app for tests that skips Lambda bundling (esbuild, and `npm install sharp` for the resize
 * function). Assertions look at resources and properties, not code, and bundling made synth slow
 * enough to trip the test timeout on CI runners.
 */
export function testApp(context: Record<string, unknown> = {}): App {
  return new App({ context: { 'aws:cdk:bundling-stacks': [], ...context } });
}
