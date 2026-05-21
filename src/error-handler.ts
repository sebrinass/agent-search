/**
 * Concise error handling for MCP SearXNG server
 * Provides clear, focused error messages that identify the root cause
 */

export interface ErrorContext {
  url?: string;
  searxngUrl?: string;
  proxyAgent?: boolean;
  username?: string;
  timeout?: number;
  query?: string;
}

export class MCPSearXNGError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MCPSearXNGError';
  }
}

export function createConfigurationError(message: string): MCPSearXNGError {
  return new MCPSearXNGError(`🔧 Configuration Error: ${message}`);
}

export function createNetworkError(error: any, context: ErrorContext): MCPSearXNGError {
  const target = context.searxngUrl ? 'SearXNG server' : 'website';
  
  if (error.code === 'ECONNREFUSED') {
    return new MCPSearXNGError(`🌐 Connection Error: ${target} is not responding (${context.url})`);
  }
  
  if (error.code === 'ENOTFOUND' || error.code === 'EAI_NONAME') {
    const hostname = context.url ? new URL(context.url).hostname : 'unknown';
    return new MCPSearXNGError(`🌐 DNS Error: Cannot resolve hostname "${hostname}"`);
  }
  
  if (error.code === 'ETIMEDOUT') {
    return new MCPSearXNGError(`🌐 Timeout Error: ${target} is too slow to respond`);
  }
  
  if (error.message?.includes('certificate')) {
    return new MCPSearXNGError(`🌐 SSL Error: Certificate problem with ${target}`);
  }
  
  // For generic fetch failures, provide root cause guidance
  const errorMsg = error.message || error.code || 'Connection failed';
  if (errorMsg === 'fetch failed' || errorMsg === 'Connection failed') {
    const guidance = context.searxngUrl 
      ? 'Check if the SEARXNG_URL is correct and the SearXNG server is available'
      : 'Check if the website URL is accessible';
    return new MCPSearXNGError(`🌐 Network Error: ${errorMsg}. ${guidance}`);
  }
  
  return new MCPSearXNGError(`🌐 Network Error: ${errorMsg}`);
}

export function createServerError(status: number, statusText: string, responseBody: string, context: ErrorContext): MCPSearXNGError {
  const target = context.searxngUrl ? 'SearXNG server' : 'Website';
  
  if (status === 403) {
    const reason = context.searxngUrl ? 'Authentication required or IP blocked' : 'Access blocked (bot detection or geo-restriction)';
    return new MCPSearXNGError(`🚫 ${target} Error (${status}): ${reason}`);
  }
  
  if (status === 404) {
    const reason = context.searxngUrl ? 'Search endpoint not found' : 'Page not found';
    return new MCPSearXNGError(`🚫 ${target} Error (${status}): ${reason}`);
  }
  
  if (status === 429) {
    return new MCPSearXNGError(`🚫 ${target} Error (${status}): Rate limit exceeded`);
  }
  
  if (status >= 500) {
    return new MCPSearXNGError(`🚫 ${target} Error (${status}): Internal server error`);
  }
  
  return new MCPSearXNGError(`🚫 ${target} Error (${status}): ${statusText}`);
}

export function createJSONError(responseText: string, context: ErrorContext): MCPSearXNGError {
  const preview = responseText.substring(0, 100).replace(/\n/g, ' ');
  return new MCPSearXNGError(`🔍 SearXNG Response Error: Invalid JSON format. Response: "${preview}..."`);
}

export function createURLFormatError(url: string): MCPSearXNGError {
  return new MCPSearXNGError(`🔧 URL Format Error: Invalid URL "${url}"`);
}

export function createContentError(message: string, url: string): MCPSearXNGError {
  return new MCPSearXNGError(`📄 Content Error: ${message} (${url})`);
}

export function createConversionError(error: any, url: string, htmlContent: string): MCPSearXNGError {
  return new MCPSearXNGError(`🔄 Conversion Error: Cannot convert HTML to Markdown (${url})`);
}

export function createEmptyContentWarning(url: string, htmlLength: number, htmlPreview: string): string {
  return `📄 Content Warning: Page fetched but appears empty after conversion (${url}). May contain only media or require JavaScript.`;
}

export function validateEnvironment(): string | null {
  const issues: string[] = [];
  
  const searxngUrl = process.env.SEARXNG_URL;
  if (!searxngUrl) {
    issues.push("SEARXNG_URL not set");
  } else {
    try {
      const url = new URL(searxngUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        issues.push(`SEARXNG_URL invalid protocol: ${url.protocol}`);
      }
    } catch (error) {
      issues.push(`SEARXNG_URL invalid format: ${searxngUrl}`);
    }
  }

  const authUsername = process.env.AUTH_USERNAME;
  const authPassword = process.env.AUTH_PASSWORD;
  
  if (authUsername && !authPassword) {
    issues.push("AUTH_USERNAME set but AUTH_PASSWORD missing");
  } else if (!authUsername && authPassword) {
    issues.push("AUTH_PASSWORD set but AUTH_USERNAME missing");
  }

  if (issues.length === 0) {
    return null;
  }

  return `⚠️ Configuration Issues: ${issues.join(', ')}. Set SEARXNG_URL (e.g., http://localhost:8080 or https://search.example.com)`;
}
