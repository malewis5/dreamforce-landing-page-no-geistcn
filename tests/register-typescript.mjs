import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

const root = new URL('../', import.meta.url).href;
// Next resolves extensionless local TS imports. Mirror just that resolution
// in Node's deterministic tests; dependencies retain their normal resolution.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(root)
      && !context.parentURL.includes('/node_modules/')) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});
