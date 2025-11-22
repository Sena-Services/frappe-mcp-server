/**
 * Configuration Manager for Multi-Tenant MCP Server
 *
 * Loads site configuration from mcp-sites.json
 * Implements 5-minute caching with on-demand loading (no polling)
 */

import fs from 'fs';

export interface SiteConfig {
  url: string;
  api_key: string;
  api_secret: string;
}

interface SitesConfigFile {
  sites: {
    [siteName: string]: SiteConfig;
  };
}

interface CachedData {
  config: SitesConfigFile;
  loadedAt: number;
}

export class ConfigManager {
  private cache: CachedData | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly configPath: string;

  constructor(configPath: string) {
    if (!configPath) {
      throw new Error('Config path is required. Set SITES_CONFIG_PATH environment variable.');
    }
    this.configPath = configPath;
    console.log(`[ConfigManager] Initialized with config path: ${this.configPath}`);
  }

  /**
   * Get configuration for a specific site
   * Uses cached config if available and not expired
   * Otherwise loads from mcp-sites.json
   */
  async getConfig(siteName: string): Promise<SiteConfig> {
    const allConfig = await this.loadConfig();

    const siteConfig = allConfig.sites[siteName];

    if (!siteConfig) {
      throw new Error(`Site not found in configuration: ${siteName}`);
    }

    return siteConfig;
  }

  /**
   * Load entire mcp-sites.json configuration
   * Uses cache if still valid
   */
  private async loadConfig(): Promise<SitesConfigFile> {
    const now = Date.now();

    // Return cached config if still valid
    if (this.cache && (now - this.cache.loadedAt) < this.CACHE_TTL) {
      console.log(`[ConfigManager] Using cached configuration`);
      return this.cache.config;
    }

    // Load fresh config
    console.log(`[ConfigManager] Loading configuration from ${this.configPath}`);

    try {
      // Check if file exists
      if (!fs.existsSync(this.configPath)) {
        console.warn(`[ConfigManager] Config file not found, creating empty config at: ${this.configPath}`);
        const emptyConfig: SitesConfigFile = { sites: {} };
        fs.writeFileSync(this.configPath, JSON.stringify(emptyConfig, null, 2));

        this.cache = {
          config: emptyConfig,
          loadedAt: now
        };

        return emptyConfig;
      }

      // Read and parse config
      const configData = fs.readFileSync(this.configPath, 'utf8');
      const config: SitesConfigFile = JSON.parse(configData);

      // Validate structure
      if (!config.sites || typeof config.sites !== 'object') {
        throw new Error('Invalid config file structure: missing "sites" object');
      }

      console.log(`[ConfigManager] Successfully loaded configuration for ${Object.keys(config.sites).length} site(s)`);

      // Cache it
      this.cache = {
        config,
        loadedAt: now
      };

      return config;

    } catch (error) {
      if (error instanceof Error) {
        console.error(`[ConfigManager] Error loading configuration:`, error.message);
        throw new Error(`Failed to load configuration from ${this.configPath}: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Invalidate cached config
   * Useful for webhook-based cache invalidation (future enhancement)
   */
  invalidateCache(siteName?: string): void {
    if (siteName) {
      console.log(`[ConfigManager] Invalidating cache (site-specific invalidation requested for: ${siteName})`);
    } else {
      console.log(`[ConfigManager] Invalidating entire cache`);
    }
    this.cache = null;
  }

  /**
   * Get cache statistics (for debugging/monitoring)
   */
  getCacheStats(): { cached: boolean; cachedSites: number; sites: string[]; age?: number } {
    if (!this.cache) {
      return {
        cached: false,
        cachedSites: 0,
        sites: []
      };
    }

    const sites = Object.keys(this.cache.config.sites);
    const age = Date.now() - this.cache.loadedAt;

    return {
      cached: true,
      cachedSites: sites.length,
      sites,
      age
    };
  }

  /**
   * List all available sites
   */
  async listAvailableSites(): Promise<string[]> {
    try {
      const config = await this.loadConfig();
      return Object.keys(config.sites);
    } catch (error) {
      console.error(`[ConfigManager] Error listing sites:`, error);
      return [];
    }
  }

  /**
   * Get full site list with details (for admin endpoints)
   */
  async getAllSites(): Promise<SitesConfigFile> {
    return await this.loadConfig();
  }
}
