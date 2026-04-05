import { setupServer } from "msw/node";
import { apiFootballHandlers } from "./handlers/api-football.js";

// MSW Node server — started, reset, and torn down via src/test/setup.js
export const server = setupServer(...apiFootballHandlers);
