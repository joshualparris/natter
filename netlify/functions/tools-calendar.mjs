import handler from "../../api/tools/calendar.js";
import { run } from "../../api/_netlify.js";
export default (request) => run(handler, request);
export const config = { path: "/api/tools/calendar" };
