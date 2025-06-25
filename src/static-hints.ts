import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url'; // Import the url helper

// This is the robust way to get the current file's directory in Node.js ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Hint {
    type: "doctype" | "workflow";
    target: string;
    hint?: string;
    id?: string;
    description?: string;
    steps?: string[];
    related_doctypes?: string[];
}

export interface StaticHints {
    doctype: Map<string, Hint[]>;
    workflow: Map<string, Hint[]>;
}

let staticHints: StaticHints = {
    doctype: new Map(),
    workflow: new Map(),
};

export async function loadStaticHints(): Promise<StaticHints> {
    console.error('Loading static hints...');
    
    // Construct the path relative to the current file, not the working directory
    const hintsDir = path.resolve(__dirname, 'server_hints');
    
    // ... the rest of the file from here is unchanged ...

    staticHints = {
        doctype: new Map(),
        workflow: new Map(),
    };
    
    try {
        const files = fs.readdirSync(hintsDir).filter(file => file.endsWith('.json'));
        console.error(`Found ${files.length} hint files in ${hintsDir}`);
        
        for (const file of files) {
            try {
                const filePath = path.join(hintsDir, file);
                const content = fs.readFileSync(filePath, 'utf8');
                const hints = JSON.parse(content) as Hint[];
                
                if (!Array.isArray(hints)) continue;
                
                for (const hint of hints) {
                    if (!hint.type || !hint.target) continue;
                    if (hint.type === 'doctype' && !hint.hint) continue;
                    if (hint.type === 'workflow' && (!hint.steps || !Array.isArray(hint.steps))) continue;
                    
                    const map = staticHints[hint.type];
                    const existing = map.get(hint.target) || [];
                    existing.push(hint);
                    map.set(hint.target, existing);
                }
            } catch (error) {
                console.error(`Error processing hint file ${file}:`, error);
            }
        }
        console.error(`Loaded ${staticHints.doctype.size} DocType hints and ${staticHints.workflow.size} workflow hints`);
        return staticHints;
    } catch (error) {
        console.error('Error loading static hints:', error);
        return staticHints;
    }
}

// ... the rest of the functions (getDocTypeHints, etc.) are unchanged
export function getDocTypeHints(doctype: string): Hint[] {
    return staticHints.doctype.get(doctype) || [];
}
export function getWorkflowHints(workflow: string): Hint[] {
    return staticHints.workflow.get(workflow) || [];
}
export function findWorkflowsForDocType(doctype: string): Hint[] {
    const results: Hint[] = [];
    for (const [_, hints] of staticHints.workflow.entries()) {
        for (const hint of hints) {
            if (hint.related_doctypes && hint.related_doctypes.includes(doctype)) {
                results.push(hint);
            }
        }
    }
    return results;
}
export async function initializeStaticHints(): Promise<void> {
    await loadStaticHints();
}