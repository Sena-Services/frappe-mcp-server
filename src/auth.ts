import { FrappeApp } from "frappe-js-sdk";

/**
 * Validates that the required API credentials are available
 * For single-tenant mode only (environment variables)
 * @returns Object indicating if credentials are valid with detailed message
 */
export function validateApiCredentials(): {
  valid: boolean;
  message: string;
} {
  const apiKey = process.env.FRAPPE_API_KEY;
  const apiSecret = process.env.FRAPPE_API_SECRET;

  if (!apiKey && !apiSecret) {
    return {
      valid: false,
      message: "Authentication failed: Both API key and API secret are missing. API key/secret is the only supported authentication method."
    };
  }

  if (!apiKey) {
    return {
      valid: false,
      message: "Authentication failed: API key is missing. API key/secret is the only supported authentication method."
    };
  }

  if (!apiSecret) {
    return {
      valid: false,
      message: "Authentication failed: API secret is missing. API key/secret is the only supported authentication method."
    };
  }

  return {
    valid: true,
    message: "API credentials validation successful."
  };
}

/**
 * Check the health of the Frappe API connection
 * Parameterized version for multi-tenant support
 * @param client - Frappe client instance
 * @returns Health status information
 */
export async function checkFrappeApiHealth(client: FrappeApp): Promise<{
  healthy: boolean;
  tokenAuth: boolean;
  message: string;
}> {
  const result = {
    healthy: false,
    tokenAuth: false,
    message: ""
  };

  try {
    // Try token authentication
    try {
      console.error("Attempting token authentication health check...");
      await client.db().getDocList("DocType", { limit: 1 });
      result.tokenAuth = true;
      console.error("Token authentication health check successful");
    } catch (tokenError) {
      console.error("Token authentication health check failed:", tokenError);
      result.tokenAuth = false;
    }

    // Set overall health status
    result.healthy = result.tokenAuth;
    result.message = result.healthy
      ? `API connection healthy. Token auth: ${result.tokenAuth}`
      : "API connection unhealthy. Token authentication failed. Please ensure your API key and secret are correct.";

    return result;
  } catch (error) {
    result.message = `Health check failed: ${(error as Error).message}`;
    console.error(`API Health Check Error: ${result.message}`);
    return result;
  }
}
