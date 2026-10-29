import runtime,{type PagesBindings} from '../server/live/worker.ts';
/** Pages Functions catch-all. ASSETS is provided by Pages, not a user-provided endpoint. */
export function onRequest(context:{request:Request;env:PagesBindings}):Promise<Response>{
 return runtime.fetch(context.request,context.env);
}
