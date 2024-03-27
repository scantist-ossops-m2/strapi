import { join } from 'node:path';

// Starts the Plop CLI programmatically
export const runCLI = async () => {
  const { Plop, run } = await import('plop'); // ESM-only

  Plop.prepare(
    {
      cwd: process.cwd(),
      configPath: join(__dirname, 'plopfile.js'),
      preload: [],
      completion: undefined,
    },
    (env) => {
      // Wrap the original run function to match the expected signature
      const wrappedRun = (liftoffEnv: any) => {
        // Assuming argv is an array of strings representing arguments,
        // and passArgsBeforeDashes might be deduced or set based on your specific needs
        const passArgsBeforeDashes = true; // Adjust based on actual needs
        // Call the original run function with adjusted arguments
        return run(liftoffEnv, undefined, passArgsBeforeDashes);
      };

      // Execute with the wrapped run function
      Plop.execute(env, wrappedRun);
    }
  );
};

// Runs a generator programmatically without prompts
export const generate = async (
  generatorName: string,
  options: unknown,
  { dir = process.cwd(), plopFile = 'plopfile.js' } = {}
) => {
  const { default: npImport } = await import('node-plop');
  const nodePlop = npImport.default;

  const plop = nodePlop(join(__dirname, plopFile), {
    destBasePath: join(dir, 'src'),
    force: false,
  });

  const generator = plop.getGenerator(generatorName);
  await generator.runActions(options, {
    onSuccess() {},
    onFailure() {},
    onComment() {},
  });
};
