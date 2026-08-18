import { Controller, Post, Get, Delete, Logger, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpToolsBuilder } from "./mcp-tools.builder";
import { InMemoryRateLimiter } from "../common/rate-limiter";

const MAX_REQUESTS_PER_WINDOW = 120;
const WINDOW_MS = 60_000;

// Reachable at /api/v1/mcp — same prefix as the rest of the REST API, so
// it rides the existing Next.js `/api/:path*` proxy rewrite without any
// new infra (the backend container has no published port of its own; see
// next.config.ts). Point an MCP client at
// https://<your-zulivio-domain>/api/v1/mcp with an Authorization: Bearer
// <api key> header — see README.md's "MCP server" section.
//
// Stateless mode (sessionIdGenerator: undefined): a fresh McpServer +
// transport per HTTP request, torn down when the response closes. No
// server-held session state, so nothing to leak or clean up between
// requests from different employees hitting the same endpoint with
// different API keys.
@Controller("api/v1/mcp")
export class McpController {
  private readonly logger = new Logger(McpController.name);

  // Per-employee, not per-IP: MCP requests are already authenticated, and
  // the thing worth bounding is a single runaway/misbehaving AI client
  // hammering this employee's key, not shared-IP noise (bootstrap/login
  // rate limiters are IP-keyed because those are pre-auth).
  private readonly limiter = new InMemoryRateLimiter(
    MAX_REQUESTS_PER_WINDOW,
    WINDOW_MS,
    "Too many MCP requests for this API key. Try again shortly.",
  );

  constructor(private readonly toolsBuilder: McpToolsBuilder) {}

  @Post()
  async handlePost(@Req() req: Request, @Res() res: Response) {
    this.limiter.assert(req.employee!.id);
    const server = this.toolsBuilder.build(req.employee!);
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (err) {
      this.logger.error(`MCP request failed: ${(err as Error).message}`);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  }

  @Get()
  handleGet(@Res() res: Response) {
    res
      .status(405)
      .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)." }, id: null });
  }

  @Delete()
  handleDelete(@Res() res: Response) {
    res
      .status(405)
      .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)." }, id: null });
  }
}
