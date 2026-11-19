import handler from "../../api/voices.js";
import { run } from "../../api/_netlify.js";
export default (request) => run(handler, request);
export const config = { path: "/api/voices" };
