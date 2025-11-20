#!/usr/bin/env python3
"""
Retrieve MCP server credentials from AI Setting
Usage: python get_credentials.py <site_name>
"""

import sys
import os
import json

# Add bench apps to path
sys.path.insert(0, '/home/SenaERP/bench/apps')

# Change to sites directory so frappe can find the site
os.chdir('/home/SenaERP/bench/sites')

import frappe

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Site name required'}))
        sys.exit(1)

    site_name = sys.argv[1]

    try:
        frappe.init(site=site_name)
        frappe.connect()

        ai_setting = frappe.get_single('AI Setting')

        if not ai_setting.enable_mcp_server:
            result = {'error': 'MCP Server is disabled in AI Settings'}
        else:
            api_key = ai_setting.mcp_frappe_api_key
            # Try get_password first (for encrypted storage), fallback to direct field access
            try:
                api_secret = ai_setting.get_password('mcp_frappe_api_secret')
            except:
                api_secret = ai_setting.mcp_frappe_api_secret

            if not api_key or not api_secret:
                result = {'error': 'MCP API credentials not configured in AI Settings'}
            else:
                result = {
                    'api_key': api_key,
                    'api_secret': api_secret
                }

        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)
    finally:
        frappe.destroy()

if __name__ == '__main__':
    main()
