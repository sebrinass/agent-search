import { Router, Request, Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { logMessage } from "./logging.js";
import { fetchAndConvertToMarkdown, PaginationOptions } from "./url-reader.js";
import { searchLibraries, fetchLibraryContext } from "./context7.js";
import { ResearchServer, ThoughtData } from "./research.js";

export interface ApiRouterOptions {
  server: Server;
  researchServer: ResearchServer;
}

export function createApiRouter(options: ApiRouterOptions): Router {
  const { server, researchServer } = options;
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.json({
      name: "augmented-search-api",
      version: "1.0.0",
      endpoints: {
        "POST /api/search": "思考+搜索融合（对应MCP search工具）",
        "POST /api/read": "URL内容读取（对应MCP read工具）",
        "POST /api/library/search": "编程库搜索（对应MCP library_search工具）",
        "POST /api/library/docs": "库文档查询（对应MCP library_docs工具）"
      }
    });
  });

  router.post("/search", async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    
    try {
      const { 
        thought, 
        thoughtNumber, 
        totalThoughts, 
        nextThoughtNeeded,
        searchedKeywords,
        site,
        time_range
      } = req.body;

      if (!thought || typeof thought !== "string") {
        res.status(400).json({ 
          error: "Missing required field: thought (string)" 
        });
        return;
      }

      if (typeof thoughtNumber !== "number" || thoughtNumber < 1) {
        res.status(400).json({ 
          error: "Invalid field: thoughtNumber (positive number)" 
        });
        return;
      }

      if (typeof totalThoughts !== "number" || totalThoughts < 1) {
        res.status(400).json({ 
          error: "Invalid field: totalThoughts (positive number)" 
        });
        return;
      }

      if (typeof nextThoughtNeeded !== "boolean") {
        res.status(400).json({ 
          error: "Missing required field: nextThoughtNeeded (boolean)" 
        });
        return;
      }

      logMessage(server, "info", `[API] Search: step ${thoughtNumber}/${totalThoughts}`);

      const thoughtData: ThoughtData = {
        thought,
        thoughtNumber,
        totalThoughts,
        nextThoughtNeeded,
        searchedKeywords,
        site,
        time_range
      };

      const result = await researchServer.processThought(thoughtData);

      const duration = Date.now() - startTime;

      if (result.isError) {
        res.json({
          success: false,
          duration: `${duration}ms`,
          error: result.content[0].text
        });
        return;
      }

      const parsedResult = JSON.parse(result.content[0].text);

      res.json({
        success: true,
        duration: `${duration}ms`,
        ...parsedResult
      });

    } catch (error: any) {
      logMessage(server, "error", `[API] Search error: ${error.message}`);
      res.status(500).json({ 
        error: error.message || "Search failed" 
      });
    }
  });

  router.post("/read", async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    
    try {
      const { 
        urls, 
        timeoutMs = 30000,
        startChar,
        maxLength,
        section,
        paragraphRange,
        readHeadings
      } = req.body;

      if (!urls || (!Array.isArray(urls) && typeof urls !== "string")) {
        res.status(400).json({ 
          error: "Missing required field: urls (string or string[])" 
        });
        return;
      }

      const urlArray = Array.isArray(urls) ? urls : [urls];
      
      if (urlArray.length === 0) {
        res.status(400).json({ 
          error: "At least one URL is required" 
        });
        return;
      }

      logMessage(server, "info", `[API] Read request: ${urlArray.length} URLs`);

      const paginationOptions: PaginationOptions = {
        startChar,
        maxLength,
        section,
        paragraphRange,
        readHeadings
      };

      const content = await fetchAndConvertToMarkdown(
        server,
        urlArray,
        timeoutMs,
        paginationOptions
      );

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        urlCount: urlArray.length,
        duration: `${duration}ms`,
        contentLength: content.length,
        content
      });

    } catch (error: any) {
      logMessage(server, "error", `[API] Read error: ${error.message}`);
      res.status(500).json({ 
        error: error.message || "Read failed" 
      });
    }
  });

  router.post("/library/search", async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    
    try {
      const { query, libraryName } = req.body;

      if (!query || typeof query !== "string") {
        res.status(400).json({ 
          error: "Missing required field: query (string)" 
        });
        return;
      }

      if (!libraryName || typeof libraryName !== "string") {
        res.status(400).json({ 
          error: "Missing required field: libraryName (string)" 
        });
        return;
      }

      logMessage(server, "info", `[API] Library search: "${libraryName}"`);

      const searchResponse = await searchLibraries(query, libraryName);

      const duration = Date.now() - startTime;

      if (searchResponse.error) {
        res.json({
          success: false,
          error: searchResponse.error,
          duration: `${duration}ms`
        });
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

    } catch (error: any) {
      logMessage(server, "error", `[API] Library search error: ${error.message}`);
      res.status(500).json({ 
        error: error.message || "Library search failed" 
      });
    }
  });

  router.post("/library/docs", async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    
    try {
      const { libraryId, query } = req.body;

      if (!libraryId || typeof libraryId !== "string") {
        res.status(400).json({ 
          error: "Missing required field: libraryId (string)" 
        });
        return;
      }

      if (!query || typeof query !== "string") {
        res.status(400).json({ 
          error: "Missing required field: query (string)" 
        });
        return;
      }

      logMessage(server, "info", `[API] Library docs: "${libraryId}"`);

      const response = await fetchLibraryContext(libraryId, query);

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        libraryId,
        query,
        duration: `${duration}ms`,
        contentLength: response.data.length,
        data: response.data
      });

    } catch (error: any) {
      logMessage(server, "error", `[API] Library docs error: ${error.message}`);
      res.status(500).json({ 
        error: error.message || "Library docs fetch failed" 
      });
    }
  });

  return router;
}
