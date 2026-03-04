import { Router, Request, Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ResearchServer, ThoughtData } from "./research.js";
import { packageVersion } from "./index.js";
import { FETCH_TIMEOUT_MS } from "./config.js";
import { fetchAndConvertToMarkdown, PaginationOptions } from "./url-reader.js";
import { searchLibraries, fetchLibraryContext } from "./context7.js";

function createTempServer(): { server: Server; researchServer: ResearchServer } {
  const server = new Server(
    { name: "augmented-search-api", version: packageVersion },
    { capabilities: { tools: {} } }
  );
  const researchServer = new ResearchServer();
  researchServer.setServer(server);
  return { server, researchServer };
}

export function createApiRouter(): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.json({
      name: "augmented-search-api",
      version: packageVersion,
      description: "无状态 REST API - 每次请求独立处理",
      endpoints: {
        "POST /api/search": "思考+搜索融合",
        "POST /api/read": "URL内容读取",
        "POST /api/library/search": "编程库搜索",
        "POST /api/library/docs": "库文档查询"
      }
    });
  });

  router.post("/search", async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    try {
      const { thought, thoughtNumber, totalThoughts, nextThoughtNeeded, searchedKeywords, site, time_range } = req.body;

      if (!thought || typeof thought !== "string") {
        res.status(400).json({ error: "Missing required field: thought (string)" });
        return;
      }
      if (typeof thoughtNumber !== "number" || thoughtNumber < 1) {
        res.status(400).json({ error: "Invalid field: thoughtNumber (positive number)" });
        return;
      }
      if (typeof totalThoughts !== "number" || totalThoughts < 1) {
        res.status(400).json({ error: "Invalid field: totalThoughts (positive number)" });
        return;
      }
      if (typeof nextThoughtNeeded !== "boolean") {
        res.status(400).json({ error: "Missing required field: nextThoughtNeeded (boolean)" });
        return;
      }

      const { server, researchServer } = createTempServer();
      const thoughtData: ThoughtData = { thought, thoughtNumber, totalThoughts, nextThoughtNeeded, searchedKeywords, site, time_range };
      const result = await researchServer.processThought(thoughtData);
      const duration = Date.now() - startTime;

      if (result.isError) {
        res.json({ success: false, duration: `${duration}ms`, error: result.content[0].text });
        return;
      }

      res.json({ success: true, duration: `${duration}ms`, ...JSON.parse(result.content[0].text) });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Search failed";
      res.status(500).json({ error: message });
    }
  });

  router.post("/read", async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    try {
      const { urls, timeoutMs, startChar, maxLength, section, paragraphRange, readHeadings } = req.body;

      if (!urls || (!Array.isArray(urls) && typeof urls !== "string")) {
        res.status(400).json({ error: "Missing required field: urls (string or string[])" });
        return;
      }

      const urlArray = Array.isArray(urls) ? urls : [urls];
      if (urlArray.length === 0) {
        res.status(400).json({ error: "At least one URL is required" });
        return;
      }

      const { server } = createTempServer();
      const paginationOptions: PaginationOptions = { startChar, maxLength, section, paragraphRange, readHeadings };
      const content = await fetchAndConvertToMarkdown(server, urlArray, timeoutMs || FETCH_TIMEOUT_MS, paginationOptions);
      const duration = Date.now() - startTime;

      res.json({ success: true, urlCount: urlArray.length, duration: `${duration}ms`, contentLength: content.length, content });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Read failed";
      res.status(500).json({ error: message });
    }
  });

  router.post("/library/search", async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    try {
      const { query, libraryName } = req.body;

      if (!query || typeof query !== "string") {
        res.status(400).json({ error: "Missing required field: query (string)" });
        return;
      }
      if (!libraryName || typeof libraryName !== "string") {
        res.status(400).json({ error: "Missing required field: libraryName (string)" });
        return;
      }

      const searchResponse = await searchLibraries(query, libraryName);
      const duration = Date.now() - startTime;

      if (searchResponse.error) {
        res.json({ success: false, error: searchResponse.error, duration: `${duration}ms` });
        return;
      }

      res.json({
        success: true,
        libraryName,
        resultCount: searchResponse.results.length,
        duration: `${duration}ms`,
        results: searchResponse.results.map(r => ({
          id: r.id,
          title: r.title,
          description: r.description,
          snippets: r.totalSnippets,
          benchmarkScore: r.benchmarkScore,
          trustScore: r.trustScore,
          versions: r.versions
        }))
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Library search failed";
      res.status(500).json({ error: message });
    }
  });

  router.post("/library/docs", async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    try {
      const { libraryId, query } = req.body;

      if (!libraryId || typeof libraryId !== "string") {
        res.status(400).json({ error: "Missing required field: libraryId (string)" });
        return;
      }
      if (!query || typeof query !== "string") {
        res.status(400).json({ error: "Missing required field: query (string)" });
        return;
      }

      const response = await fetchLibraryContext(libraryId, query);
      const duration = Date.now() - startTime;

      res.json({ success: true, libraryId, query, duration: `${duration}ms`, contentLength: response.data.length, data: response.data });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Library docs fetch failed";
      res.status(500).json({ error: message });
    }
  });

  return router;
}
