import handler from "../../api/setup-tools.js";
import { run } from "../../api/_netlify.js";
export default (request) => run(handler, request);
export const config = { path: "/api/setup-tools" };
