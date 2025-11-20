import { FrappeApp } from "frappe-js-sdk";

export interface FrappeClientConfig {
  url: string;
  api_key: string;
  api_secret: string;
  team_name?: string;
}

/**
 * Create a Frappe client with specific credentials
 * This factory function allows creating multiple clients with different credentials
 */
export function createFrappeClient(config: FrappeClientConfig): FrappeApp {
  const { url, api_key, api_secret, team_name = "" } = config;

  console.error(`[AUTH] Creating Frappe client for URL: ${url}`);
  console.error(`[AUTH] API Key available: ${!!api_key}`);
  console.error(`[AUTH] API Secret available: ${!!api_secret}`);

  if (!api_key || !api_secret) {
    throw new Error("Authentication failed: Missing API key or secret. Both are required.");
  }

  // Create token getter function
  const getToken = () => {
    const token = `${api_key}:${api_secret}`;

    if (!token.includes(':') || token === ':' || token.startsWith(':') || token.endsWith(':')) {
      throw new Error("Authentication failed: Malformed token. Check API key and secret format.");
    }

    return token;
  };

  // Initialize Frappe JS SDK
  const client = new FrappeApp(url, {
    useToken: true,
    token: getToken,
    type: "token",
  });

  // Add request interceptor
  client.axios.interceptors.request.use(config => {
    config.headers = config.headers || {};
    config.headers['X-Press-Team'] = team_name;

    console.error(`[REQUEST] ${config.method?.toUpperCase()} ${config.url}`);

    return config;
  });

  // Add response interceptor
  client.axios.interceptors.response.use(
    response => {
      console.error(`[RESPONSE] Status: ${response.status}`);
      return response;
    },
    error => {
      console.error(`[ERROR] Response error:`, error.message);

      if (error.response) {
        console.error(`[ERROR] Status: ${error.response.status}`);

        if (error.response.status === 401 || error.response.status === 403) {
          console.error(`[AUTH ERROR] Authentication failed`);
          error.authError = true;
        }
      }

      return Promise.reject(error);
    }
  );

  return client;
}
