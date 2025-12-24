import { Context, Middleware } from './types.ts';

export function createPipeline(middlewares: Middleware[]) {
  return {
    async execute(initialCtx: Context): Promise<Context> {
      const ctx = initialCtx;
      let index = 0;

      const dispatch = async (): Promise<void> => {
        if (index >= middlewares.length) return;
        
        const middleware = middlewares[index];
        index++;
        
        await middleware(ctx, dispatch);
      };

      await dispatch();
      return ctx;
    }
  };
}