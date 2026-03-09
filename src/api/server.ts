/**
 * Server lifecycle management for the Always-On Memory Agent HTTP API.
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerRoutes } from './routes.js';
import type { ServerDependencies } from './types.js';

/**
 * Creates a Fastify server instance with all routes registered.
 */
export function createServer(deps: ServerDependencies): FastifyInstance {
  const server = Fastify({ logger: true });
  registerRoutes(server, deps);
  return server;
}

/**
 * Starts the Fastify server listening on the specified port.
 */
export async function startServer(server: FastifyInstance, port: number): Promise<void> {
  await server.listen({ port, host: '0.0.0.0' });
}

/**
 * Gracefully stops the Fastify server.
 */
export async function stopServer(server: FastifyInstance): Promise<void> {
  await server.close();
}
