import { AxiosError } from "axios";

/**
 * Error class for Frappe API errors
 */
export class FrappeApiError extends Error {
  statusCode?: number;
  endpoint?: string;
  details?: any;

  constructor(message: string, statusCode?: number, endpoint?: string, details?: any) {
    super(message);
    this.name = "FrappeApiError";
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    this.details = details;
  }

  static fromAxiosError(error: AxiosError, operation: string): FrappeApiError {
    const statusCode = error.response?.status;
    const endpoint = error.config?.url || "unknown";
    let message = `Frappe API error during ${operation}: ${error.message}`;
    let details = null;

    // Check for connection errors first (no response)
    if (!error.response) {
      message = `Network error during ${operation}: ${error.message}`;
      details = { error: "Network error", code: error.code };
    }
    // Extract more detailed error information from Frappe's response
    else if (error.response) {
      try {
        const data = error.response.data as any;
        
        if (error.response.status === 401 || error.response.status === 403) {
          message = `Authentication failed during ${operation}. Check API key/secret.`;
          details = {
            error: "Authentication Error",
            status: error.response.status,
            statusText: error.response.statusText,
            responseData: data
          };
        } else if (data && data.exception) {
          message = `Frappe exception during ${operation}: ${data.exception}`;
          details = data;
        } else if (data && data._server_messages) {
          try {
            // Server messages are often JSON strings inside a string
            const serverMessages = JSON.parse(data._server_messages);
            const parsedMessages = Array.isArray(serverMessages)
              ? serverMessages.map((msg: string) => {
                try {
                  return JSON.parse(msg);
                } catch {
                  return msg;
                }
              })
              : [serverMessages];

            message = `Frappe server message during ${operation}: ${parsedMessages.map((m: any) => m.message || m).join("; ")}`;
            details = { serverMessages: parsedMessages };
          } catch (e) {
            message = `Frappe server message during ${operation}: ${data._server_messages}`;
            details = { serverMessages: data._server_messages };
          }
        } else if (data && data.message) {
          message = `Frappe API error during ${operation}: ${data.message}`;
          details = data;
        }
      } catch (e) {
        console.error(`[FrappeApiError] Error accessing response data: ${e}`);
        // Fallback if data access fails
        message = `Frappe API error during ${operation}: ${error.message} (Response data inaccessible)`;
      }
    }

    return new FrappeApiError(message, statusCode, endpoint, details);
  }
}

/**
 * Helper function to handle API errors
 */
export function handleApiError(error: any, operation: string): never {
  if (error.isAxiosError) {
    throw FrappeApiError.fromAxiosError(error, operation);
  }
  // Handle frappe-js-sdk errors (plain objects with httpStatus)
  else if (error.httpStatus !== undefined) {
    // Extract the actual error from frappe-js-sdk response
    let message = `Error during ${operation}: `;
    let serverMessageText = '';

    // Parse _server_messages if present
    if (error._server_messages) {
      try {
        const serverMessages = typeof error._server_messages === 'string'
          ? JSON.parse(error._server_messages)
          : error._server_messages;
        const parsedMessages = Array.isArray(serverMessages)
          ? serverMessages.map((msg: string) => {
              try {
                const parsed = JSON.parse(msg);
                return parsed.message || msg;
              } catch {
                return msg;
              }
            })
          : [serverMessages];
        serverMessageText = parsedMessages.join('; ');
      } catch {
        serverMessageText = String(error._server_messages);
      }
    }

    if (serverMessageText) {
      message += serverMessageText;
    } else if (error.exception) {
      message += error.exception;
    } else {
      message += error.message || 'Unknown error';
    }

    throw new FrappeApiError(
      message,
      error.httpStatus,
      undefined,
      {
        httpStatus: error.httpStatus,
        httpStatusText: error.httpStatusText,
        exception: error.exception,
        serverMessages: serverMessageText || null,
        exc: error.exc ? String(error.exc).substring(0, 500) : null
      }
    );
  }
  else {
    throw new FrappeApiError(
      `Error during ${operation}: ${(error as Error).message || 'Unknown error'}`,
      undefined, // statusCode
      undefined, // endpoint
      error // Pass original error as details
    );
  }
}