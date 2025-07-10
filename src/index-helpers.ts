import {
  findDocTypes,
  getModuleList,
  getDocTypesInModule,
  doesDocTypeExist,
  doesDocumentExist,
  getDocumentCount,
  getNamingSeriesInfo,
  getRequiredFields
} from "./frappe-helpers.js";
import { getInstructions } from "./frappe-instructions.js";
import { callMethod } from "./frappe-api.js";

// Define new tool handlers
export async function handleHelperToolCall(request: any): Promise<any> {
  const { name, arguments: args } = request.params;

  if (!args) {
    return {
      content: [{ type: "text", text: "Missing arguments for tool call" }],
      isError: true,
    };
  }

  try {
    console.error("Handling helper tool: " + name + " with args:", args);

    switch (name) {
      case "find_doctypes":
        const searchTerm = args.search_term || "";
        const options = {
          module: args.module,
          isTable: args.is_table,
          isSingle: args.is_single,
          isCustom: args.is_custom,
          limit: args.limit || 20
        };
        const doctypes = await findDocTypes(searchTerm, options);
        return {
          content: [{ type: "text", text: JSON.stringify(doctypes, null, 2) }],
        };

      case "get_module_list":
        const modules = await getModuleList();
        return {
          content: [{ type: "text", text: JSON.stringify(modules, null, 2) }],
        };

      case "get_doctypes_in_module":
        if (!args.module) {
          return {
            content: [{ type: "text", text: "Missing required parameter: module" }],
            isError: true,
          };
        }
        const moduleDocTypes = await getDocTypesInModule(args.module);
        return {
          content: [{ type: "text", text: JSON.stringify(moduleDocTypes, null, 2) }],
        };

      case "check_doctype_exists":
        if (!args.doctype) {
          return {
            content: [{ type: "text", text: "Missing required parameter: doctype" }],
            isError: true,
          };
        }
        const doctypeExists = await doesDocTypeExist(args.doctype);
        return {
          content: [{ type: "text", text: JSON.stringify({ exists: doctypeExists }, null, 2) }],
        };

      case "check_document_exists":
        if (!args.doctype || !args.name) {
          return {
            content: [{ type: "text", text: "Missing required parameters: doctype and name" }],
            isError: true,
          };
        }
        const documentExists = await doesDocumentExist(args.doctype, args.name);
        return {
          content: [{ type: "text", text: JSON.stringify({ exists: documentExists }, null, 2) }],
        };

      case "get_document_count":
        if (!args.doctype) {
          return {
            content: [{ type: "text", text: "Missing required parameter: doctype" }],
            isError: true,
          };
        }
        const count = await getDocumentCount(args.doctype, args.filters || {});
        return {
          content: [{ type: "text", text: JSON.stringify({ count }, null, 2) }],
        };

      case "get_naming_info":
        if (!args.doctype) {
          return {
            content: [{ type: "text", text: "Missing required parameter: doctype" }],
            isError: true,
          };
        }
        const namingInfo = await getNamingSeriesInfo(args.doctype);
        return {
          content: [{ type: "text", text: JSON.stringify(namingInfo, null, 2) }],
        };

      case "get_required_fields":
        if (!args.doctype) {
          return {
            content: [{ type: "text", text: "Missing required parameter: doctype" }],
            isError: true,
          };
        }
        const requiredFields = await getRequiredFields(args.doctype);
        return {
          content: [{ type: "text", text: JSON.stringify(requiredFields, null, 2) }],
        };

      case "get_api_instructions":
        if (!args.category || !args.operation) {
          return {
            content: [{ type: "text", text: "Missing required parameters: category and operation" }],
            isError: true,
          };
        }
        const instructions = getInstructions(args.category, args.operation);
        return {
          content: [{ type: "text", text: instructions }],
        };
      
      case "send_whatsapp_message":
        if (!args.to || !args.message) {
          return {
            content: [{ type: "text", text: "Missing required parameters: to and message" }],
            isError: true,
          };
        }
        try {
          const result = await callMethod(
            "frappe_whatsapp.frappe_whatsapp.doctype.whatsapp_message.whatsapp_message.send_whatsapp_message",
            {
              to: args.to,
              message: args.message,
              content_type: args.content_type || "text",
              reference_doctype: args.reference_doctype,
              reference_name: args.reference_name,
            }
          );
          return {
            content: [{
              type: "text",
              text: `WhatsApp message sent successfully. Result: ${JSON.stringify(result, null, 2)}`
            }],
          };
        } catch (error) {
          console.error("Error sending WhatsApp message:", error);
          return {
            content: [{ type: "text", text: "Failed to send WhatsApp message: " + (error as Error).message }],
            isError: true,
          };
        }

      case "send_instagram_message":
        if (!args.to || !args.message) {
          return {
            content: [{ type: "text", text: "Missing required parameters: to and message" }],
            isError: true,
          };
        }
        try {
          const result = await callMethod(
            "frappe_whatsapp.frappe_whatsapp.doctype.instagram_message.instagram_message.send_instagram_message",
            {
              to: args.to,
              message: args.message,
              content_type: args.content_type || "text",
              reference_doctype: args.reference_doctype,
              reference_name: args.reference_name,
            }
          );
          return {
            content: [{
              type: "text",
              text: `Instagram message sent successfully. Result: ${JSON.stringify(result, null, 2)}`
            }],
          };
        } catch (error) {
          console.error("Error sending Instagram message:", error);
          return {
            content: [{ type: "text", text: "Failed to send Instagram message: " + (error as Error).message }],
            isError: true,
          };
        }

      default:
        return {
          content: [{ type: "text", text: "Helper module doesn't handle tool: " + name }],
          isError: true,
        };
    }
  } catch (error) {
    console.error("Error in helper tool " + name + ":", error);
    return {
      content: [{ type: "text", text: "Error in helper tool " + name + ": " + (error as Error).message }],
      isError: true,
    };
  }
}