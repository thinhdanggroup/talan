import * as vscode from "vscode";
import axios, { AxiosError, AxiosRequestConfig } from "axios";
import TurndownService from "turndown";
import { logger } from "../logger";

export type ServerResponse = Record<string, unknown>;

export interface ConfluenceContent extends ServerResponse {
  id: string;
  type: string;
  body?: {
    storage?: {
      value: string;
    };
  };
}

interface ConfluenceCredentials {
  username: string;
  token: string;
}

export class DataService {
  private static readonly CACHE_KEY = "server-data-cache";
  private static readonly CACHE_TIMESTAMP_KEY = "server-data-timestamp";
  private static readonly CACHE_DURATION = 1000 * 60 * 60; // 1 hour in milliseconds
  private turndownService: TurndownService;

  constructor(private context: vscode.ExtensionContext) {
    logger.appendLine('Initializing Data Service');
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced'
    });
    logger.appendLine('TurndownService initialized');
  }

  private convertHtmlToMarkdown(html: string): string {
    logger.appendLine('Converting HTML to Markdown');
    const markdown = this.turndownService.turndown(html);
    logger.appendLine('HTML conversion completed');
    return markdown;
  }

  private extractContent(data: ServerResponse): string {
    logger.appendLine('Extracting content from response');
    if (this.isConfluenceUrl('')) {  // Using empty string as we just need to check if it's confluence data
      const confluenceData = data as ConfluenceContent;
      const content = confluenceData.body?.storage?.value || JSON.stringify(data, null, 2);
      logger.appendLine('Extracted Confluence content');
      return content;
    }
    logger.appendLine('Extracted regular JSON content');
    return JSON.stringify(data, null, 2);
  }

  private processConfluenceResponse(data: ServerResponse): string | undefined {
    logger.appendLine('Processing Confluence response');
    const confluenceData = data as ConfluenceContent;
    if (confluenceData.body?.storage?.value) {
      logger.appendLine('Converting Confluence HTML content to Markdown');
      const markdown = this.convertHtmlToMarkdown(confluenceData.body.storage.value);
      return markdown;
    }
    logger.appendLine('No HTML content found in Confluence response');
    return confluenceData.body?.storage?.value;
  }

  private isConfluenceUrl(url: string): boolean {
    const isConfluence = url.toLowerCase().includes("confluence") || url.toLowerCase().includes("atlassian");
    logger.appendLine(`URL check - Is Confluence: ${isConfluence}`);
    return isConfluence;
  }

  private formatConfluenceUrl(url: string): string {
    logger.appendLine(`Formatting Confluence URL: ${url}`);
    if (!this.isConfluenceUrl(url)) {
      logger.appendLine('Not a Confluence URL, returning original');
      return url;
    }

    // Handle Confluence Cloud URLs
    if (url.includes("atlassian.net/wiki/spaces")) {
      logger.appendLine('Processing Confluence Cloud URL');
      // Extract page ID from URL
      const pageIdMatch = url.match(/pages\/(\d+)/);
      if (!pageIdMatch) {
        logger.appendLine('Failed to extract page ID from URL');
        throw new Error("Could not extract page ID from Confluence URL");
      }
      const pageId = pageIdMatch[1];
      logger.appendLine(`Extracted page ID: ${pageId}`);
      
      // Transform to API URL format
      const domainMatch = url.match(/https:\/\/(.*?)\.atlassian\.net/);
      if (!domainMatch) {
        logger.appendLine('Failed to extract domain from URL');
        throw new Error("Could not extract domain from Confluence URL");
      }
      const domain = domainMatch[1];
      
      const apiUrl = `https://${domain}.atlassian.net/wiki/rest/api/content/${pageId}?expand=body.storage`;
      logger.appendLine(`Formatted API URL: ${apiUrl}`);
      return apiUrl;
    }

    // Handle other Confluence URLs (on-premise)
    if (!url.includes("/rest/api/content")) {
      const baseUrl = url.endsWith("/") ? url.slice(0, -1) : url;
      const apiUrl = `${baseUrl}/rest/api/content`;
      logger.appendLine(`Formatted on-premise API URL: ${apiUrl}`);
      return apiUrl;
    }

    return url;
  }

  private getConfluenceCredentials(): ConfluenceCredentials | null {
    logger.appendLine('Getting Confluence credentials');
    const config = vscode.workspace.getConfiguration("talan");
    const username = config.get<string>("confluence.username");
    const token = config.get<string>("confluence.token");

    if (!username || !token) {
      logger.appendLine('Confluence credentials not found');
      return null;
    }

    logger.appendLine('Confluence credentials retrieved successfully');
    return { username, token };
  }

  async fetchData(url: string): Promise<string> {
    try {
      logger.appendLine(`Starting data fetch for URL: ${url}`);
      
      // Check cache first
      const cachedData = this.getCachedData(url);
      if (cachedData && 
          typeof cachedData === 'object' && 
          'content' in cachedData && 
          typeof cachedData.content === 'string') {
        logger.appendLine(`Using cached data for ${url}`);
        return cachedData.content;
      }
      logger.appendLine(`No cache found, fetching fresh data from ${url}`);

      // Prepare request config
      const config: AxiosRequestConfig = {};

      // Add Confluence authentication if needed
      if (this.isConfluenceUrl(url)) {
        logger.appendLine('Setting up Confluence authentication');
        url = this.formatConfluenceUrl(url);
        const credentials = this.getConfluenceCredentials();
        if (!credentials) {
          logger.appendLine('Confluence credentials not found');
          throw new Error(
            "Confluence credentials not found. Please configure them in VSCode settings."
          );
        }

        const auth = Buffer.from(
          `${credentials.username}:${credentials.token}`
        ).toString("base64");
        config.headers = {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          "X-Atlassian-Token": "no-check",
          Accept: "application/json"
        };
        logger.appendLine('Confluence authentication configured');
      }

      // If no cache or expired, fetch from server
      logger.appendLine('Making HTTP request');
      const response = await axios.get<ServerResponse>(url, config);
      const data = response.data;
      logger.appendLine('Data fetched successfully');

      let extractedContent: string;
      
      // Process and extract content based on type
      if (this.isConfluenceUrl(url) && typeof data === 'object' && data !== null) {
        logger.appendLine('Processing Confluence data');
        extractedContent = this.processConfluenceResponse(data) || '';
      } else {
        extractedContent = this.extractContent(data);
      }

      // Store in cache consistently
      logger.appendLine('Caching response data');
      await this.cacheData(url, { content: extractedContent });
      return extractedContent;
    } catch (error) {
      logger.appendLine('Error occurred during fetch');
      if (error instanceof AxiosError) {
        logger.appendLine(`Axios error: ${error.message}`);
        logger.appendLine(`Response data: ${JSON.stringify(error.response?.data || {})}`);
        
        if (this.isConfluenceUrl(url)) {
          throw new Error(
            `Failed to fetch Confluence data. Please ensure:\n` +
            `1. Your email is correct (username for Confluence Cloud)\n` +
            `2. You're using an API token (not password)\n` +
            `3. You have permission to access this page\n` +
            `4. The page ID is correct\n\n` +
            `Error details: ${error.response?.data?.message || error.message}`
          );
        }
        
        throw new Error(`Failed to fetch data: ${error.message}`);
      }
      throw new Error("An unexpected error occurred");
    }
  }

  public isDataFromCache(url: string, content: string): boolean {
    logger.appendLine(`Checking if data is from cache for URL: ${url}`);
    const cachedData = this.getCachedData(url);
    if (!cachedData || typeof cachedData !== 'object' || !('content' in cachedData)) {
      logger.appendLine('No valid cache found');
      return false;
    }
    const isFromCache = cachedData.content === content;
    logger.appendLine(`Cache check result: ${isFromCache}`);
    return isFromCache;
  }

  private getCachedData(url: string): ServerResponse | null {
    logger.appendLine(`Getting cached data for URL: ${url}`);
    const timestamp = this.context.globalState.get<number>(
      `${DataService.CACHE_TIMESTAMP_KEY}-${url}`
    );
    const cachedData = this.context.globalState.get<ServerResponse>(
      `${DataService.CACHE_KEY}-${url}`
    );

    if (!timestamp || !cachedData) {
      logger.appendLine('No cache found');
      return null;
    }

    // Check if cache is expired
    const now = Date.now();
    if (now - timestamp > DataService.CACHE_DURATION) {
      logger.appendLine('Cache is expired');
      return null;
    }

    logger.appendLine('Valid cache found');
    return cachedData;
  }

  private async cacheData(url: string, data: ServerResponse): Promise<void> {
    logger.appendLine(`Caching data for URL: ${url}`);
    await this.context.globalState.update(
      `${DataService.CACHE_KEY}-${url}`,
      data
    );
    await this.context.globalState.update(
      `${DataService.CACHE_TIMESTAMP_KEY}-${url}`,
      Date.now()
    );
    logger.appendLine('Data cached successfully');
  }

  async clearCache(url: string): Promise<void> {
    logger.appendLine(`Clearing cache for URL: ${url}`);
    await this.context.globalState.update(
      `${DataService.CACHE_KEY}-${url}`,
      undefined
    );
    await this.context.globalState.update(
      `${DataService.CACHE_TIMESTAMP_KEY}-${url}`,
      undefined
    );
    logger.appendLine('Cache cleared successfully');
  }
}
