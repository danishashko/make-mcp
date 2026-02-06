import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { MakeDatabase } from '../database/db.js';

interface MakeModule {
    id: string;
    name: string;
    app: string;
    type: 'trigger' | 'action' | 'search';
    description: string;
    parameters: any[];
    documentation?: string;
}

// Helper to define a module concisely
function m(id: string, name: string, app: string, type: 'trigger' | 'action' | 'search', description: string, parameters: any[], documentation?: string): MakeModule {
    const mod: MakeModule = { id, name, app, type, description, parameters };
    if (documentation !== undefined) mod.documentation = documentation;
    return mod;
}

// Helper to define a parameter concisely
function p(name: string, type: string, required: boolean, description: string, extra?: Record<string, any>) {
    return { name, type, required, description, ...extra };
}

export class ModuleScraper {
    private db: MakeDatabase;

    constructor() {
        this.db = new MakeDatabase();
    }

    async scrapeFromMakeAPI(): Promise<MakeModule[]> {
        const apiKey = process.env.MAKE_API_KEY;
        if (!apiKey || apiKey === 'your_api_key_here') {
            console.log('No valid MAKE_API_KEY set, using built-in module catalog');
            return this.getModuleCatalog();
        }

        try {
            const baseUrl = process.env.MAKE_API_URL || 'https://eu1.make.com/api/v2';
            const response = await axios.get(`${baseUrl}/modules`, {
                headers: { 'Authorization': `Token ${apiKey}` }
            });
            return response.data.modules;
        } catch (error) {
            console.log('Make API modules endpoint not available, using built-in catalog');
            return this.getModuleCatalog();
        }
    }

    private getModuleCatalog(): MakeModule[] {
        return [
            // ═══════════════════════════════════════
            // WEBHOOKS (2 modules)
            // ═══════════════════════════════════════
            m('gateway:CustomWebHook', 'Custom Webhook', 'Webhooks', 'trigger',
                'Receive data via a custom webhook URL. Starts the scenario when data is sent to the webhook endpoint via HTTP POST.',
                [p('name', 'text', true, 'Webhook name'), p('dataStructure', 'select', false, 'Expected data structure for type-safe mapping')],
                '## Custom Webhook\nTrigger a scenario via HTTP POST to a unique webhook URL.\n\n### Usage\n1. Create the webhook in Make\n2. Copy the webhook URL\n3. Send POST/GET requests with data to that URL\n\n### Tips\n- Define a data structure for proper field mapping\n- Webhooks timeout after 30s if no response is sent'),
            m('gateway:WebhookRespond', 'Webhook Response', 'Webhooks', 'action',
                'Send a custom HTTP response back to the webhook caller with status code, headers, and body. Must be paired with a Custom Webhook trigger.',
                [p('status', 'number', true, 'HTTP status code (e.g., 200, 201, 400)', { default: 200 }), p('body', 'text', true, 'Response body (text, JSON, or HTML)'), p('headers', 'array', false, 'Custom response headers as key-value pairs')]),

            // ═══════════════════════════════════════
            // HTTP (4 modules)
            // ═══════════════════════════════════════
            m('http:ActionSendData', 'Make a Request', 'HTTP', 'action',
                'Make HTTP requests to any URL or API endpoint. Supports all HTTP methods, custom headers, query strings, and request body. The universal connector for any API.',
                [p('method', 'select', true, 'HTTP method', { options: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] }), p('url', 'url', true, 'Request URL'), p('headers', 'array', false, 'Request headers as key-value pairs'), p('queryString', 'array', false, 'Query string parameters'), p('body', 'text', false, 'Request body'), p('bodyType', 'select', false, 'Content type', { options: ['Raw', 'application/x-www-form-urlencoded', 'multipart/form-data'] }), p('parseResponse', 'boolean', false, 'Automatically parse response JSON/XML', { default: true }), p('timeout', 'number', false, 'Request timeout in seconds')],
                '## HTTP Request\nThe universal connector for any REST API.\n\n### Common Use Cases\n- Calling REST APIs without a dedicated Make app\n- Sending data to third-party services\n- Fetching external data\n- Integrating with internal company APIs'),
            m('http:ActionGetFile', 'Get a File', 'HTTP', 'action',
                'Download a file from a URL. Returns the file as binary data for use in subsequent modules like Google Drive Upload or Email Attachment.',
                [p('url', 'url', true, 'File URL to download'), p('shareDrive', 'boolean', false, 'Evaluate Google Drive shared links')]),
            m('http:ActionSendDataBasicAuth', 'Make a Basic Auth Request', 'HTTP', 'action',
                'Make an HTTP request with Basic Authentication (username/password) to APIs that require basic auth credentials.',
                [p('method', 'select', true, 'HTTP method', { options: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] }), p('url', 'url', true, 'Request URL'), p('username', 'text', true, 'Basic auth username'), p('password', 'text', true, 'Basic auth password'), p('headers', 'array', false, 'Request headers'), p('body', 'text', false, 'Request body')]),
            m('http:ActionRetrieveHeaders', 'Retrieve Headers', 'HTTP', 'action',
                'Retrieve HTTP headers from a URL without downloading the body. Useful for checking content types, file sizes, or redirect locations.',
                [p('url', 'url', true, 'URL to check'), p('method', 'select', false, 'HTTP method', { options: ['HEAD', 'GET'], default: 'HEAD' })]),

            // ═══════════════════════════════════════
            // JSON (3 modules)
            // ═══════════════════════════════════════
            m('json:ParseJSON', 'Parse JSON', 'JSON', 'action',
                'Parse a JSON string into structured data that can be mapped in subsequent modules. Essential for processing API responses.',
                [p('json', 'text', true, 'JSON string to parse'), p('dataStructure', 'select', false, 'Expected data structure for type-safe mapping')]),
            m('json:TransformToJSON', 'Create JSON', 'JSON', 'action',
                'Create a JSON string from mapped data fields. Use for building API request bodies.',
                [p('dataStructure', 'select', true, 'Data structure to serialize into JSON')]),
            m('json:AggregateToJSON', 'Aggregate to JSON', 'JSON', 'action',
                'Aggregate multiple bundles into a single JSON array string. Combines multiple items into one JSON output.',
                [p('sourceModule', 'select', true, 'Module whose output to aggregate'), p('dataStructure', 'select', false, 'Structure for each item')]),

            // ═══════════════════════════════════════
            // GOOGLE SHEETS (14 modules — real: 27 total)
            // ═══════════════════════════════════════
            m('google-sheets:ActionAddRow', 'Add a Row', 'Google Sheets', 'action',
                'Appends a new row to the bottom of a Google Sheets spreadsheet table.',
                [p('spreadsheetId', 'text', true, 'Spreadsheet ID or URL'), p('sheetName', 'text', true, 'Sheet/tab name'), p('values', 'array', true, 'Row values to add'), p('tableContainsHeaders', 'boolean', false, 'Whether first row contains headers', { default: true })]),
            m('google-sheets:ActionUpdateRow', 'Update a Row', 'Google Sheets', 'action',
                'Update an existing row in a Google Sheets spreadsheet by row number.',
                [p('spreadsheetId', 'text', true, 'Spreadsheet ID'), p('sheetName', 'text', true, 'Sheet/tab name'), p('rowNumber', 'number', true, 'Row number to update'), p('values', 'array', true, 'New values for the row')]),
            m('google-sheets:ActionDeleteRow', 'Delete a Row', 'Google Sheets', 'action',
                'Deletes a specific row from a Google Sheets spreadsheet by row number.',
                [p('spreadsheetId', 'text', true, 'Spreadsheet ID'), p('sheetName', 'text', true, 'Sheet/tab name'), p('rowNumber', 'number', true, 'Row number to delete')]),
            m('google-sheets:ActionClearRow', 'Clear a Row', 'Google Sheets', 'action',
                'Clears values from a specific row without deleting the row itself.',
                [p('spreadsheetId', 'text', true, 'Spreadsheet ID'), p('sheetName', 'text', true, 'Sheet/tab name'), p('rowNumber', 'number', true, 'Row number to clear')]),
            m('google-sheets:ActionClearCell', 'Clear a Cell', 'Google Sheets', 'action',
                'Clears a specific cell in a Google Sheets spreadsheet.',
                [p('spreadsheetId', 'text', true, 'Spreadsheet ID'), p('sheetName', 'text', true, 'Sheet/tab name'), p('cell', 'text', true, 'Cell reference (e.g., A1, B5)')]),
            m('google-sheets:ActionBulkAddRows', 'Bulk Add Rows', 'Google Sheets', 'action',
                'Appends multiple rows to the bottom of a spreadsheet table in a single operation.',
                [p('spreadsheetId', 'text', true, 'Spreadsheet ID'), p('sheetName', 'text', true, 'Sheet/tab name'), p('values', 'array', true, 'Array of row arrays to add')]),
            m('google-sheets:ActionBulkUpdateRows', 'Bulk Update Rows', 'Google Sheets', 'action',
                'Updates multiple rows at once. More efficient than updating rows one at a time.',
                [p('spreadsheetId', 'text', true, 'Spreadsheet ID'), p('sheetName', 'text', true, 'Sheet/tab name'), p('rows', 'array', true, 'Array of {rowNumber, values} objects')]),
            m('google-sheets:ActionClearRange', 'Clear Values from a Range', 'Google Sheets', 'action',
                'Clears a specified range of values from a spreadsheet.',
                [p('spreadsheetId', 'text', true, 'Spreadsheet ID'), p('range', 'text', true, 'Range in A1 notation (e.g., Sheet1!A1:D10)')]),
            m('google-sheets:ActionAddSheet', 'Add a Sheet', 'Google Sheets', 'action',
                'Adds a new sheet/tab to an existing spreadsheet.',
                [p('spreadsheetId', 'text', true, 'Spreadsheet ID'), p('title', 'text', true, 'New sheet name')]),
            m('google-sheets:ActionCopySheet', 'Copy a Sheet', 'Google Sheets', 'action',
                'Copies a sheet to another spreadsheet.',
                [p('sourceSpreadsheetId', 'text', true, 'Source spreadsheet ID'), p('sourceSheetId', 'number', true, 'Source sheet ID'), p('destinationSpreadsheetId', 'text', true, 'Destination spreadsheet ID')]),
            m('google-sheets:ActionAddConditionalFormat', 'Add a Conditional Format Rule', 'Google Sheets', 'action',
                'Creates a new conditional format rule at a given index. All subsequent rules indexes are incremented.',
                [p('spreadsheetId', 'text', true, 'Spreadsheet ID'), p('sheetId', 'number', true, 'Sheet ID'), p('range', 'text', true, 'Cell range'), p('type', 'select', true, 'Condition type')]),
            m('google-sheets:TriggerWatchRows', 'Watch Rows', 'Google Sheets', 'trigger',
                'Trigger when new rows are added to a Google Sheets spreadsheet. Detects new data automatically.',
                [p('spreadsheetId', 'text', true, 'Spreadsheet ID'), p('sheetName', 'text', true, 'Sheet/tab name'), p('tableContainsHeaders', 'boolean', false, 'Whether first row contains headers', { default: true }), p('limit', 'number', false, 'Max rows to return per run')]),
            m('google-sheets:TriggerWatchChanges', 'Watch Changes', 'Google Sheets', 'trigger',
                'Trigger when any cell value changes in a Google Sheets spreadsheet.',
                [p('spreadsheetId', 'text', true, 'Spreadsheet ID'), p('sheetName', 'text', true, 'Sheet/tab name')]),
            m('google-sheets:SearchRows', 'Search Rows', 'Google Sheets', 'search',
                'Search for rows matching specific criteria in a Google Sheets spreadsheet using column filters.',
                [p('spreadsheetId', 'text', true, 'Spreadsheet ID'), p('sheetName', 'text', true, 'Sheet/tab name'), p('filter', 'text', true, 'Filter column and value'), p('sortOrder', 'select', false, 'Sort results', { options: ['asc', 'desc'] })]),
            m('google-sheets:SearchRowByNumber', 'Get a Row', 'Google Sheets', 'search',
                'Retrieves a specific row by its row number.',
                [p('spreadsheetId', 'text', true, 'Spreadsheet ID'), p('sheetName', 'text', true, 'Sheet/tab name'), p('rowNumber', 'number', true, 'Row number to retrieve')]),

            // ═══════════════════════════════════════
            // OPENAI (11 modules — real: 31 total)
            // ═══════════════════════════════════════
            m('openai:ActionCreateCompletion', 'Create a Completion', 'OpenAI (ChatGPT, DALL-E, Whisper)', 'action',
                'Generate text using OpenAI chat models. Send messages with system, user, and assistant roles to get AI-generated responses.',
                [p('model', 'select', true, 'Model to use', { options: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1', 'o1-mini', 'o3-mini'] }), p('messages', 'array', true, 'Array of messages with role and content'), p('temperature', 'number', false, 'Sampling temperature (0-2)', { default: 0.7 }), p('maxTokens', 'number', false, 'Maximum tokens in response'), p('responseFormat', 'select', false, 'Response format', { options: ['text', 'json_object'] }), p('tools', 'array', false, 'Function calling tools/definitions')]),
            m('openai:ActionAnalyzeImages', 'Analyze Images (Vision)', 'OpenAI (ChatGPT, DALL-E, Whisper)', 'action',
                'Analyzes images according to specified instructions using GPT-4 Vision. Describe, extract text, or answer questions about images.',
                [p('model', 'select', true, 'Vision model', { options: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] }), p('imageUrl', 'url', true, 'Image URL or base64 data'), p('prompt', 'text', true, 'Instructions for analyzing the image'), p('maxTokens', 'number', false, 'Maximum tokens in response')]),
            m('openai:ActionCreateImage', 'Generate an Image', 'OpenAI (ChatGPT, DALL-E, Whisper)', 'action',
                'Generate images from text descriptions using DALL-E. Creates original images from natural language prompts.',
                [p('prompt', 'text', true, 'Image description prompt'), p('model', 'select', false, 'DALL-E model', { options: ['dall-e-3', 'dall-e-2'] }), p('size', 'select', false, 'Image size', { options: ['1024x1024', '1792x1024', '1024x1792', '512x512', '256x256'] }), p('quality', 'select', false, 'Image quality', { options: ['standard', 'hd'] }), p('n', 'number', false, 'Number of images to generate', { default: 1 })]),
            m('openai:ActionEditImage', 'Edit Images', 'OpenAI (ChatGPT, DALL-E, Whisper)', 'action',
                'Creates an edited or extended image given one or more source images and a prompt.',
                [p('image', 'buffer', true, 'Source image file'), p('prompt', 'text', true, 'Description of the edit to make'), p('mask', 'buffer', false, 'Mask image indicating areas to edit'), p('size', 'select', false, 'Output image size', { options: ['1024x1024', '512x512', '256x256'] })]),
            m('openai:ActionTranscribe', 'Create a Transcription', 'OpenAI (ChatGPT, DALL-E, Whisper)', 'action',
                'Transcribe audio to text using Whisper. Supports mp3, mp4, mpeg, mpga, m4a, wav, and webm formats.',
                [p('file', 'buffer', true, 'Audio file to transcribe'), p('model', 'select', true, 'Whisper model', { options: ['whisper-1'] }), p('language', 'text', false, 'Language code (ISO-639-1)'), p('prompt', 'text', false, 'Optional prompt to guide transcription'), p('responseFormat', 'select', false, 'Output format', { options: ['json', 'text', 'srt', 'vtt'] })]),
            m('openai:ActionTranslate', 'Create a Translation', 'OpenAI (ChatGPT, DALL-E, Whisper)', 'action',
                'Translate audio into English text using Whisper. Takes audio in any language and outputs English text.',
                [p('file', 'buffer', true, 'Audio file to translate'), p('model', 'select', true, 'Model', { options: ['whisper-1'] }), p('prompt', 'text', false, 'Optional prompt to guide translation')]),
            m('openai:ActionCreateEmbedding', 'Create an Embedding', 'OpenAI (ChatGPT, DALL-E, Whisper)', 'action',
                'Create vector embeddings from text for semantic search, clustering, and classification tasks.',
                [p('input', 'text', true, 'Text to embed'), p('model', 'select', true, 'Embedding model', { options: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'] })]),
            m('openai:ActionTextToSpeech', 'Transform Text to Speech', 'OpenAI (ChatGPT, DALL-E, Whisper)', 'action',
                'Convert text to lifelike spoken audio using OpenAI TTS models.',
                [p('input', 'text', true, 'Text to convert to speech'), p('model', 'select', true, 'TTS model', { options: ['tts-1', 'tts-1-hd'] }), p('voice', 'select', true, 'Voice', { options: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] }), p('responseFormat', 'select', false, 'Audio format', { options: ['mp3', 'opus', 'aac', 'flac'] })]),
            m('openai:ActionCreateBatch', 'Create a Batch', 'OpenAI (ChatGPT, DALL-E, Whisper)', 'action',
                'Creates and executes a batch of API calls for processing large volumes of requests at reduced cost.',
                [p('inputFileId', 'text', true, 'Input file ID containing batch requests'), p('endpoint', 'select', true, 'API endpoint', { options: ['/v1/chat/completions', '/v1/embeddings'] }), p('completionWindow', 'select', true, 'Completion window', { options: ['24h'] })]),
            m('openai:TriggerWatchResponses', 'Watch Responses', 'OpenAI (ChatGPT, DALL-E, Whisper)', 'trigger',
                'Triggers when a new stored response is created in OpenAI.',
                [p('model', 'select', false, 'Filter by model')]),
            m('openai:SearchModels', 'List Models', 'OpenAI (ChatGPT, DALL-E, Whisper)', 'search',
                'Lists all available OpenAI models that you have access to.',
                []),

            // ═══════════════════════════════════════
            // GMAIL (8 modules — real: 13 total)
            // ═══════════════════════════════════════
            m('gmail:ActionSendEmail', 'Send an Email', 'Gmail', 'action',
                'Send an email from your Gmail account. Supports HTML content, attachments, CC, BCC, and reply-to.',
                [p('to', 'email', true, 'Recipient email address(es)'), p('subject', 'text', true, 'Email subject line'), p('body', 'text', true, 'Email body (plain text or HTML)'), p('cc', 'email', false, 'CC recipients'), p('bcc', 'email', false, 'BCC recipients'), p('replyTo', 'email', false, 'Reply-to address'), p('attachments', 'array', false, 'File attachments'), p('isHtml', 'boolean', false, 'Whether body is HTML')]),
            m('gmail:ActionCreateDraft', 'Create a Draft', 'Gmail', 'action',
                'Create a draft email in Gmail without sending it.',
                [p('to', 'email', true, 'Recipient email'), p('subject', 'text', true, 'Subject line'), p('body', 'text', true, 'Email body'), p('cc', 'email', false, 'CC recipients')]),
            m('gmail:ActionMoveEmail', 'Move an Email', 'Gmail', 'action',
                'Move an email to a specified Gmail label/folder.',
                [p('emailId', 'text', true, 'Email message ID'), p('label', 'text', true, 'Destination label')]),
            m('gmail:ActionMarkAsRead', 'Mark an Email as Read', 'Gmail', 'action',
                'Mark an email as read or unread.',
                [p('emailId', 'text', true, 'Email message ID'), p('read', 'boolean', true, 'Mark as read (true) or unread (false)')]),
            m('gmail:ActionDeleteEmail', 'Delete an Email', 'Gmail', 'action',
                'Permanently delete an email or move it to trash.',
                [p('emailId', 'text', true, 'Email message ID'), p('permanent', 'boolean', false, 'Permanently delete (skip trash)')]),
            m('gmail:ActionAddLabel', 'Add a Label', 'Gmail', 'action',
                'Add a label to an email message.',
                [p('emailId', 'text', true, 'Email message ID'), p('label', 'text', true, 'Label to add')]),
            m('gmail:TriggerWatchEmails', 'Watch Emails', 'Gmail', 'trigger',
                'Trigger when a new email arrives in your Gmail inbox. Can filter by label, sender, subject, or full-text search.',
                [p('label', 'text', false, 'Filter by Gmail label'), p('from', 'email', false, 'Filter by sender address'), p('subject', 'text', false, 'Filter by subject keyword'), p('search', 'text', false, 'Gmail search query (e.g., "has:attachment is:unread")')]),
            m('gmail:SearchEmails', 'Search Emails', 'Gmail', 'search',
                'Search Gmail messages using Gmail search syntax.',
                [p('query', 'text', true, 'Gmail search query'), p('maxResults', 'number', false, 'Maximum results to return')]),

            // ═══════════════════════════════════════
            // GOOGLE DRIVE (10 modules — real: 32 total)
            // ═══════════════════════════════════════
            m('google-drive:ActionUploadFile', 'Upload a File', 'Google Drive', 'action',
                'Upload a file to Google Drive. Supports any file type.',
                [p('folderId', 'text', false, 'Target folder ID (root if empty)'), p('fileName', 'text', true, 'Name for the uploaded file'), p('data', 'buffer', true, 'File data to upload'), p('mimeType', 'text', false, 'File MIME type')]),
            m('google-drive:ActionCreateFolder', 'Create a Folder', 'Google Drive', 'action',
                'Creates a new folder in Google Drive.',
                [p('name', 'text', true, 'Folder name'), p('parentId', 'text', false, 'Parent folder ID')]),
            m('google-drive:ActionCopyFile', 'Copy a File', 'Google Drive', 'action',
                'Makes a copy of an existing file in Google Drive.',
                [p('fileId', 'text', true, 'Source file ID'), p('name', 'text', false, 'New file name'), p('folderId', 'text', false, 'Destination folder ID')]),
            m('google-drive:ActionMoveFile', 'Move a File/Folder', 'Google Drive', 'action',
                'Moves a file or folder to a different location in Google Drive.',
                [p('fileId', 'text', true, 'File or folder ID'), p('folderId', 'text', true, 'Destination folder ID')]),
            m('google-drive:ActionDeleteFile', 'Delete a File/Folder', 'Google Drive', 'action',
                'Permanently deletes a file or folder owned by the user without moving it to the trash.',
                [p('fileId', 'text', true, 'File or folder ID to delete')]),
            m('google-drive:ActionDownloadFile', 'Download a File', 'Google Drive', 'action',
                'Downloads a file from Google Drive as binary data.',
                [p('fileId', 'text', true, 'File ID to download')]),
            m('google-drive:ActionCreateFromText', 'Create a File from Text', 'Google Drive', 'action',
                'Creates a new file from plain text content.',
                [p('name', 'text', true, 'File name'), p('content', 'text', true, 'Text content'), p('folderId', 'text', false, 'Destination folder'), p('mimeType', 'text', false, 'MIME type', { default: 'text/plain' })]),
            m('google-drive:ActionShareFile', 'Share a File/Folder', 'Google Drive', 'action',
                'Updates sharing permissions for a file or folder.',
                [p('fileId', 'text', true, 'File or folder ID'), p('role', 'select', true, 'Permission role', { options: ['reader', 'writer', 'commenter', 'owner'] }), p('type', 'select', true, 'Permission type', { options: ['user', 'group', 'domain', 'anyone'] }), p('emailAddress', 'email', false, 'Email for user/group permissions')]),
            m('google-drive:TriggerWatchFiles', 'Watch Files', 'Google Drive', 'trigger',
                'Trigger when a new file is created or an existing file is modified in Google Drive.',
                [p('folderId', 'text', false, 'Folder to watch (all if empty)'), p('watch', 'select', false, 'Watch for', { options: ['created', 'modified', 'all'] })]),
            m('google-drive:SearchFiles', 'Search Files/Folders', 'Google Drive', 'search',
                'Search for files and folders in Google Drive using search queries.',
                [p('query', 'text', false, 'Search query'), p('folderId', 'text', false, 'Limit search to folder'), p('mimeType', 'text', false, 'Filter by MIME type')]),

            // ═══════════════════════════════════════
            // GOOGLE DOCS (5 modules)
            // ═══════════════════════════════════════
            m('google-docs:ActionCreateDocument', 'Create a Document', 'Google Docs', 'action',
                'Creates a new Google Docs document.',
                [p('title', 'text', true, 'Document title'), p('content', 'text', false, 'Initial document content'), p('folderId', 'text', false, 'Google Drive folder ID')]),
            m('google-docs:ActionInsertText', 'Insert a Text to a Document', 'Google Docs', 'action',
                'Inserts text at a specified location in a Google Docs document.',
                [p('documentId', 'text', true, 'Document ID'), p('text', 'text', true, 'Text to insert'), p('location', 'select', true, 'Where to insert', { options: ['end', 'beginning', 'index'] })]),
            m('google-docs:ActionReplaceText', 'Replace Text in a Document', 'Google Docs', 'action',
                'Replaces all occurrences of a text string in a Google Docs document.',
                [p('documentId', 'text', true, 'Document ID'), p('searchText', 'text', true, 'Text to find'), p('replaceText', 'text', true, 'Replacement text'), p('matchCase', 'boolean', false, 'Case-sensitive match')]),
            m('google-docs:ActionGetContent', 'Get a Content of a Document', 'Google Docs', 'action',
                'Retrieves the full content of a Google Docs document.',
                [p('documentId', 'text', true, 'Document ID')]),
            m('google-docs:ActionDownloadDocument', 'Download a Document', 'Google Docs', 'action',
                'Downloads a Google Docs document in a specified format.',
                [p('documentId', 'text', true, 'Document ID'), p('format', 'select', true, 'Export format', { options: ['pdf', 'docx', 'txt', 'html', 'epub', 'odt'] })]),

            // ═══════════════════════════════════════
            // GOOGLE CALENDAR (6 modules)
            // ═══════════════════════════════════════
            m('google-calendar:ActionCreateEvent', 'Create an Event', 'Google Calendar', 'action',
                'Creates a new event in a Google Calendar.',
                [p('calendarId', 'text', true, 'Calendar ID'), p('summary', 'text', true, 'Event title'), p('start', 'date', true, 'Start date/time'), p('end', 'date', true, 'End date/time'), p('description', 'text', false, 'Event description'), p('location', 'text', false, 'Event location'), p('attendees', 'array', false, 'Attendee email addresses'), p('reminders', 'array', false, 'Reminder settings')]),
            m('google-calendar:ActionUpdateEvent', 'Update an Event', 'Google Calendar', 'action',
                'Updates an existing event in Google Calendar.',
                [p('calendarId', 'text', true, 'Calendar ID'), p('eventId', 'text', true, 'Event ID'), p('summary', 'text', false, 'Updated title'), p('start', 'date', false, 'Updated start'), p('end', 'date', false, 'Updated end')]),
            m('google-calendar:ActionDeleteEvent', 'Delete an Event', 'Google Calendar', 'action',
                'Deletes an event from Google Calendar.',
                [p('calendarId', 'text', true, 'Calendar ID'), p('eventId', 'text', true, 'Event ID')]),
            m('google-calendar:ActionQuickAddEvent', 'Quick Add an Event', 'Google Calendar', 'action',
                'Creates an event using natural language text (e.g., "Meeting with John tomorrow at 3pm").',
                [p('calendarId', 'text', true, 'Calendar ID'), p('text', 'text', true, 'Natural language event description')]),
            m('google-calendar:TriggerWatchEvents', 'Watch Events', 'Google Calendar', 'trigger',
                'Trigger when a new event is created, updated, or starts in Google Calendar.',
                [p('calendarId', 'text', true, 'Calendar ID'), p('watch', 'select', false, 'Watch for', { options: ['created', 'updated', 'started'] })]),
            m('google-calendar:SearchEvents', 'Search Events', 'Google Calendar', 'search',
                'Search for events in a Google Calendar within a date range.',
                [p('calendarId', 'text', true, 'Calendar ID'), p('query', 'text', false, 'Search text'), p('timeMin', 'date', false, 'Start of search range'), p('timeMax', 'date', false, 'End of search range')]),

            // ═══════════════════════════════════════
            // SLACK (12 modules — real: 46 total)
            // ═══════════════════════════════════════
            m('slack:ActionPostMessage', 'Post a Message', 'Slack', 'action',
                'Post a message to a Slack channel, group, or direct message. Supports rich text formatting, Block Kit, and attachments.',
                [p('channel', 'text', true, 'Channel ID or name (#general)'), p('text', 'text', true, 'Message text (supports Slack mrkdwn)'), p('username', 'text', false, 'Override bot username'), p('iconEmoji', 'text', false, 'Override bot icon emoji (e.g., :robot:)'), p('iconUrl', 'url', false, 'Override bot icon URL'), p('blocks', 'array', false, 'Block Kit blocks for rich layouts'), p('threadTs', 'text', false, 'Thread timestamp to reply in thread')]),
            m('slack:ActionEditMessage', 'Edit a Message', 'Slack', 'action',
                'Edits an existing Slack message.',
                [p('channel', 'text', true, 'Channel ID'), p('ts', 'text', true, 'Message timestamp'), p('text', 'text', true, 'New message text')]),
            m('slack:ActionDeleteMessage', 'Delete a Message', 'Slack', 'action',
                'Removes a Slack message from a channel.',
                [p('channel', 'text', true, 'Channel ID'), p('ts', 'text', true, 'Message timestamp')]),
            m('slack:ActionAddReaction', 'Add a Reaction', 'Slack', 'action',
                'Adds an emoji reaction to a message.',
                [p('channel', 'text', true, 'Channel ID'), p('ts', 'text', true, 'Message timestamp'), p('emoji', 'text', true, 'Emoji name without colons (e.g., thumbsup)')]),
            m('slack:ActionCreateChannel', 'Create a Channel', 'Slack', 'action',
                'Creates a new Slack channel.',
                [p('name', 'text', true, 'Channel name (lowercase, no spaces)'), p('isPrivate', 'boolean', false, 'Create as private channel')]),
            m('slack:ActionArchiveChannel', 'Archive a Channel', 'Slack', 'action',
                'Archives a Slack channel.',
                [p('channel', 'text', true, 'Channel ID to archive')]),
            m('slack:ActionInviteToChannel', 'Invite to Channel', 'Slack', 'action',
                'Invites a user to a Slack channel.',
                [p('channel', 'text', true, 'Channel ID'), p('user', 'text', true, 'User ID to invite')]),
            m('slack:ActionSetTopic', 'Set a Topic', 'Slack', 'action',
                'Sets the topic of a Slack channel.',
                [p('channel', 'text', true, 'Channel ID'), p('topic', 'text', true, 'New channel topic')]),
            m('slack:ActionUploadFile', 'Upload a File', 'Slack', 'action',
                'Upload a file to a Slack channel.',
                [p('channels', 'text', true, 'Channel ID(s) to share the file in'), p('file', 'buffer', true, 'File data'), p('filename', 'text', true, 'File name'), p('title', 'text', false, 'File title'), p('initialComment', 'text', false, 'Initial comment')]),
            m('slack:ActionCreateReminder', 'Create a Reminder', 'Slack', 'action',
                'Creates a reminder for a user.',
                [p('text', 'text', true, 'Reminder text'), p('time', 'text', true, 'When to remind (e.g., "in 5 minutes", "tomorrow at 9am")'), p('user', 'text', false, 'User ID (defaults to self)')]),
            m('slack:TriggerWatchMessages', 'Watch Public Channel Messages', 'Slack', 'trigger',
                'Trigger when a new message is posted in a public Slack channel.',
                [p('channel', 'text', true, 'Channel to watch'), p('limit', 'number', false, 'Max messages per run')]),
            m('slack:TriggerWatchPrivateMessages', 'Watch Private Channel Messages', 'Slack', 'trigger',
                'Trigger when a new message is posted in a private Slack channel.',
                [p('channel', 'text', true, 'Private channel to watch')]),
            m('slack:TriggerWatchReactions', 'Watch Reactions', 'Slack', 'trigger',
                'Trigger when a reaction (emoji) is added to a message.',
                [p('channel', 'text', false, 'Channel to watch (all if empty)')]),
            m('slack:SearchMessages', 'Search Messages', 'Slack', 'search',
                'Search Slack messages matching a query.',
                [p('query', 'text', true, 'Search query'), p('sort', 'select', false, 'Sort by', { options: ['score', 'timestamp'] })]),
            m('slack:SearchUsers', 'Get a User', 'Slack', 'search',
                'Retrieves information about a Slack user.',
                [p('userId', 'text', true, 'User ID')]),
            m('slack:SearchChannels', 'Get a Channel', 'Slack', 'search',
                'Returns details about a Slack channel.',
                [p('channelId', 'text', true, 'Channel ID')]),

            // ═══════════════════════════════════════
            // NOTION (10 modules — real: 30 total)
            // ═══════════════════════════════════════
            m('notion:ActionCreateDatabaseItem', 'Create a Database Item', 'Notion', 'action',
                'Creates a new item (page) in a Notion database with specified property values.',
                [p('databaseId', 'text', true, 'Notion database ID'), p('properties', 'object', true, 'Property values for the new item'), p('content', 'array', false, 'Page content blocks')]),
            m('notion:ActionUpdateDatabaseItem', 'Update a Database Item', 'Notion', 'action',
                'Updates properties of an existing item in a Notion database.',
                [p('pageId', 'text', true, 'Page/item ID'), p('properties', 'object', true, 'Updated property values')]),
            m('notion:ActionCreatePage', 'Create a Page', 'Notion', 'action',
                'Creates a new page in a specified parent page in Notion.',
                [p('parentPageId', 'text', true, 'Parent page ID'), p('title', 'text', true, 'Page title'), p('content', 'array', false, 'Page content blocks (paragraphs, headings, etc.)')]),
            m('notion:ActionAppendPageContent', 'Append a Page Content', 'Notion', 'action',
                'Appends new content blocks to an existing Notion page.',
                [p('pageId', 'text', true, 'Page ID'), p('children', 'array', true, 'Content blocks to append')]),
            m('notion:ActionCreateDatabase', 'Create a Database', 'Notion', 'action',
                'Creates a new database in Notion with specified properties/columns.',
                [p('parentPageId', 'text', true, 'Parent page ID'), p('title', 'text', true, 'Database title'), p('properties', 'object', true, 'Database property definitions')]),
            m('notion:ActionDeletePageContent', 'Delete a Page Content', 'Notion', 'action',
                'Archives (soft-deletes) a page content block in Notion.',
                [p('blockId', 'text', true, 'Block ID to archive')]),
            m('notion:TriggerWatchDatabaseItems', 'Watch Database Items', 'Notion', 'trigger',
                'Trigger when new items are added to a Notion database.',
                [p('databaseId', 'text', true, 'Notion database ID'), p('limit', 'number', false, 'Max items per run')]),
            m('notion:TriggerWatchPages', 'Watch Pages', 'Notion', 'trigger',
                'Trigger when pages are created or updated in Notion.',
                [p('parentId', 'text', false, 'Parent page or database ID')]),
            m('notion:SearchDatabaseItems', 'Search Database Items', 'Notion', 'search',
                'Query a Notion database with filters and sorts.',
                [p('databaseId', 'text', true, 'Database ID'), p('filter', 'object', false, 'Filter conditions'), p('sort', 'array', false, 'Sort criteria')]),
            m('notion:SearchPages', 'Search Pages', 'Notion', 'search',
                'Search for pages across your entire Notion workspace.',
                [p('query', 'text', true, 'Search text')]),

            // ═══════════════════════════════════════
            // AIRTABLE (8 modules — real: 13 total)
            // ═══════════════════════════════════════
            m('airtable:ActionCreateRecord', 'Create a Record', 'Airtable', 'action',
                'Creates a new record in an Airtable base table with specified field values.',
                [p('baseId', 'text', true, 'Airtable base ID'), p('tableId', 'text', true, 'Table name or ID'), p('fields', 'object', true, 'Field values for the new record')]),
            m('airtable:ActionUpdateRecord', 'Update a Record', 'Airtable', 'action',
                'Updates an existing record in Airtable.',
                [p('baseId', 'text', true, 'Airtable base ID'), p('tableId', 'text', true, 'Table name or ID'), p('recordId', 'text', true, 'Record ID'), p('fields', 'object', true, 'Updated field values')]),
            m('airtable:ActionDeleteRecord', 'Delete a Record', 'Airtable', 'action',
                'Deletes a record from Airtable by its ID.',
                [p('baseId', 'text', true, 'Base ID'), p('tableId', 'text', true, 'Table name or ID'), p('recordId', 'text', true, 'Record ID to delete')]),
            m('airtable:ActionGetRecord', 'Get a Record', 'Airtable', 'action',
                'Retrieves a single record by its ID.',
                [p('baseId', 'text', true, 'Base ID'), p('tableId', 'text', true, 'Table name'), p('recordId', 'text', true, 'Record ID')]),
            m('airtable:ActionBulkCreate', 'Bulk Create Records', 'Airtable', 'search',
                'Creates multiple records in one operation.',
                [p('baseId', 'text', true, 'Base ID'), p('tableId', 'text', true, 'Table name'), p('records', 'array', true, 'Array of record objects')]),
            m('airtable:ActionBulkUpdate', 'Bulk Update Records', 'Airtable', 'search',
                'Updates multiple existing records in one operation.',
                [p('baseId', 'text', true, 'Base ID'), p('tableId', 'text', true, 'Table name'), p('records', 'array', true, 'Array of {id, fields} objects')]),
            m('airtable:SearchRecords', 'Search Records', 'Airtable', 'search',
                'Searches for specific records or returns all records in an Airtable table. Supports formula-based filtering.',
                [p('baseId', 'text', true, 'Airtable base ID'), p('tableId', 'text', true, 'Table name or ID'), p('filterByFormula', 'text', false, 'Airtable filter formula'), p('sort', 'array', false, 'Sort configuration'), p('maxRecords', 'number', false, 'Max records to return')]),
            m('airtable:TriggerWatchRecords', 'Watch Records', 'Airtable', 'trigger',
                'Trigger when new records are created in an Airtable table.',
                [p('baseId', 'text', true, 'Base ID'), p('tableId', 'text', true, 'Table name'), p('limit', 'number', false, 'Max records per run')]),

            // ═══════════════════════════════════════
            // TELEGRAM BOT (10 modules — real: 32 total)
            // ═══════════════════════════════════════
            m('telegram:TriggerWatchUpdates', 'Watch Updates', 'Telegram Bot', 'trigger',
                'Trigger when the bot receives new messages, commands, or callbacks in Telegram.',
                [p('limit', 'number', false, 'Max updates per run'), p('allowedUpdates', 'array', false, 'Filter update types (message, edited_message, callback_query, etc.)')]),
            m('telegram:ActionSendTextMessage', 'Send a Text Message', 'Telegram Bot', 'action',
                'Sends a text message to a Telegram chat. Supports HTML and Markdown formatting.',
                [p('chatId', 'text', true, 'Chat ID or @username'), p('text', 'text', true, 'Message text'), p('parseMode', 'select', false, 'Formatting mode', { options: ['HTML', 'Markdown', 'MarkdownV2'] }), p('disableNotification', 'boolean', false, 'Send silently'), p('replyToMessageId', 'number', false, 'Message ID to reply to'), p('replyMarkup', 'object', false, 'Inline keyboard or custom keyboard')]),
            m('telegram:ActionSendPhoto', 'Send a Photo', 'Telegram Bot', 'action',
                'Sends a photo to a Telegram chat.',
                [p('chatId', 'text', true, 'Chat ID'), p('photo', 'buffer', true, 'Photo file or URL'), p('caption', 'text', false, 'Photo caption')]),
            m('telegram:ActionSendDocument', 'Send a Document', 'Telegram Bot', 'action',
                'Sends a document/file to a Telegram chat.',
                [p('chatId', 'text', true, 'Chat ID'), p('document', 'buffer', true, 'Document file'), p('caption', 'text', false, 'Document caption'), p('filename', 'text', false, 'File name')]),
            m('telegram:ActionSendVideo', 'Send a Video', 'Telegram Bot', 'action',
                'Sends a video to a Telegram chat.',
                [p('chatId', 'text', true, 'Chat ID'), p('video', 'buffer', true, 'Video file or URL'), p('caption', 'text', false, 'Video caption')]),
            m('telegram:ActionEditMessage', 'Edit a Text Message', 'Telegram Bot', 'action',
                'Edits text of a previously sent message.',
                [p('chatId', 'text', true, 'Chat ID'), p('messageId', 'number', true, 'Message ID'), p('text', 'text', true, 'New message text')]),
            m('telegram:ActionDeleteMessage', 'Delete a Message', 'Telegram Bot', 'action',
                'Deletes a message (can only delete messages sent less than 48 hours ago).',
                [p('chatId', 'text', true, 'Chat ID'), p('messageId', 'number', true, 'Message ID')]),
            m('telegram:ActionForwardMessage', 'Forward a Message', 'Telegram Bot', 'action',
                'Forwards a message from one chat to another within Telegram.',
                [p('chatId', 'text', true, 'Destination chat ID'), p('fromChatId', 'text', true, 'Source chat ID'), p('messageId', 'number', true, 'Message ID to forward')]),
            m('telegram:ActionDownloadFile', 'Download a File', 'Telegram Bot', 'action',
                'Downloads a file from the Telegram server by file ID.',
                [p('fileId', 'text', true, 'Telegram file ID')]),
            m('telegram:ActionMakeAPICall', 'Make an API Call', 'Telegram Bot', 'action',
                'Makes a custom Telegram Bot API call for any method not covered by other modules.',
                [p('method', 'text', true, 'API method name'), p('body', 'object', false, 'Request parameters')]),

            // ═══════════════════════════════════════
            // HUBSPOT CRM (10 modules — real: 121 total)
            // ═══════════════════════════════════════
            m('hubspot:ActionCreateContact', 'Create a Contact', 'HubSpot CRM', 'action',
                'Creates a new contact in HubSpot CRM with specified properties.',
                [p('email', 'email', true, 'Contact email'), p('firstName', 'text', false, 'First name'), p('lastName', 'text', false, 'Last name'), p('phone', 'text', false, 'Phone number'), p('company', 'text', false, 'Company name'), p('properties', 'object', false, 'Additional contact properties')]),
            m('hubspot:ActionUpdateContact', 'Update a Contact', 'HubSpot CRM', 'action',
                'Updates an existing contact in HubSpot CRM.',
                [p('contactId', 'text', true, 'Contact ID'), p('properties', 'object', true, 'Updated property values')]),
            m('hubspot:ActionCreateDeal', 'Create a Deal', 'HubSpot CRM', 'action',
                'Creates a new deal in HubSpot CRM pipeline.',
                [p('dealName', 'text', true, 'Deal name'), p('pipeline', 'text', true, 'Pipeline ID'), p('dealStage', 'text', true, 'Deal stage ID'), p('amount', 'number', false, 'Deal amount'), p('closeDate', 'date', false, 'Expected close date'), p('properties', 'object', false, 'Additional deal properties')]),
            m('hubspot:ActionUpdateDeal', 'Update a Deal', 'HubSpot CRM', 'action',
                'Updates an existing deal in HubSpot CRM.',
                [p('dealId', 'text', true, 'Deal ID'), p('properties', 'object', true, 'Updated properties')]),
            m('hubspot:ActionCreateCompany', 'Create a Company', 'HubSpot CRM', 'action',
                'Creates a new company in HubSpot CRM.',
                [p('name', 'text', true, 'Company name'), p('domain', 'text', false, 'Company domain'), p('industry', 'text', false, 'Industry'), p('properties', 'object', false, 'Additional properties')]),
            m('hubspot:ActionCreateTicket', 'Create a Ticket', 'HubSpot CRM', 'action',
                'Creates a new support ticket in HubSpot.',
                [p('subject', 'text', true, 'Ticket subject'), p('content', 'text', false, 'Ticket description'), p('pipeline', 'text', true, 'Pipeline ID'), p('status', 'text', true, 'Ticket status')]),
            m('hubspot:ActionAddContactToList', 'Add Members to a List', 'HubSpot CRM', 'action',
                'Adds contact records to a HubSpot contact list.',
                [p('listId', 'text', true, 'List ID'), p('contactIds', 'array', true, 'Array of contact IDs to add')]),
            m('hubspot:TriggerWatchContacts', 'Watch Contacts', 'HubSpot CRM', 'trigger',
                'Trigger when a new contact is created in HubSpot CRM.',
                [p('limit', 'number', false, 'Max contacts per run')]),
            m('hubspot:TriggerWatchDeals', 'Watch Deals', 'HubSpot CRM', 'trigger',
                'Trigger when a new deal is created or updated in HubSpot CRM.',
                [p('pipeline', 'text', false, 'Filter by pipeline'), p('limit', 'number', false, 'Max deals per run')]),
            m('hubspot:SearchContacts', 'Search Contacts', 'HubSpot CRM', 'search',
                'Search for contacts in HubSpot CRM using filters.',
                [p('query', 'text', false, 'Search query'), p('filters', 'array', false, 'Filter groups'), p('limit', 'number', false, 'Max results')]),

            // ═══════════════════════════════════════
            // MICROSOFT TEAMS (5 modules)
            // ═══════════════════════════════════════
            m('microsoft-teams:ActionSendMessage', 'Send a Message', 'Microsoft Teams', 'action',
                'Send a message to a Microsoft Teams channel or chat. Supports HTML formatting.',
                [p('teamId', 'text', true, 'Team ID'), p('channelId', 'text', true, 'Channel ID'), p('message', 'text', true, 'Message content (supports HTML)'), p('contentType', 'select', false, 'Content type', { options: ['text', 'html'] })]),
            m('microsoft-teams:ActionCreateChannel', 'Create a Channel', 'Microsoft Teams', 'action',
                'Creates a new channel in a Microsoft Teams team.',
                [p('teamId', 'text', true, 'Team ID'), p('displayName', 'text', true, 'Channel name'), p('description', 'text', false, 'Channel description')]),
            m('microsoft-teams:ActionReplyToMessage', 'Reply to a Message', 'Microsoft Teams', 'action',
                'Reply to an existing message in a Teams channel.',
                [p('teamId', 'text', true, 'Team ID'), p('channelId', 'text', true, 'Channel ID'), p('messageId', 'text', true, 'Parent message ID'), p('message', 'text', true, 'Reply content')]),
            m('microsoft-teams:TriggerWatchMessages', 'Watch Channel Messages', 'Microsoft Teams', 'trigger',
                'Trigger when a new message is posted in a Teams channel.',
                [p('teamId', 'text', true, 'Team ID'), p('channelId', 'text', true, 'Channel ID')]),
            m('microsoft-teams:SearchMembers', 'List Team Members', 'Microsoft Teams', 'search',
                'Lists all members of a Microsoft Teams team.',
                [p('teamId', 'text', true, 'Team ID')]),

            // ═══════════════════════════════════════
            // MICROSOFT OUTLOOK (5 modules)
            // ═══════════════════════════════════════
            m('microsoft-outlook:ActionSendEmail', 'Send an Email', 'Microsoft Outlook 365', 'action',
                'Send an email from your Microsoft 365 Outlook account.',
                [p('to', 'email', true, 'Recipient email'), p('subject', 'text', true, 'Subject'), p('body', 'text', true, 'Email body'), p('cc', 'email', false, 'CC'), p('bcc', 'email', false, 'BCC'), p('attachments', 'array', false, 'File attachments'), p('isHtml', 'boolean', false, 'HTML body')]),
            m('microsoft-outlook:ActionCreateDraft', 'Create a Draft Message', 'Microsoft Outlook 365', 'action',
                'Create a draft email in Outlook without sending.',
                [p('to', 'email', true, 'Recipient'), p('subject', 'text', true, 'Subject'), p('body', 'text', true, 'Body')]),
            m('microsoft-outlook:ActionCreateEvent', 'Create an Event', 'Microsoft Outlook 365', 'action',
                'Create a calendar event in Microsoft Outlook.',
                [p('subject', 'text', true, 'Event subject'), p('start', 'date', true, 'Start date/time'), p('end', 'date', true, 'End date/time'), p('attendees', 'array', false, 'Attendee emails')]),
            m('microsoft-outlook:TriggerWatchEmails', 'Watch Emails', 'Microsoft Outlook 365', 'trigger',
                'Trigger when a new email arrives in your Outlook inbox.',
                [p('folder', 'text', false, 'Mail folder (default: Inbox)'), p('filter', 'text', false, 'OData filter query')]),
            m('microsoft-outlook:SearchEmails', 'Search Emails', 'Microsoft Outlook 365', 'search',
                'Search emails in Microsoft Outlook 365.',
                [p('query', 'text', true, 'Search query'), p('folder', 'text', false, 'Folder to search')]),

            // ═══════════════════════════════════════
            // DISCORD (5 modules)
            // ═══════════════════════════════════════
            m('discord:ActionSendMessage', 'Send a Message', 'Discord', 'action',
                'Send a message to a Discord channel using a bot.',
                [p('channelId', 'text', true, 'Channel ID'), p('content', 'text', true, 'Message content'), p('embeds', 'array', false, 'Rich embeds'), p('tts', 'boolean', false, 'Text-to-speech')]),
            m('discord:ActionEditMessage', 'Edit a Message', 'Discord', 'action',
                'Edit a previously sent Discord message.',
                [p('channelId', 'text', true, 'Channel ID'), p('messageId', 'text', true, 'Message ID'), p('content', 'text', true, 'New content')]),
            m('discord:ActionDeleteMessage', 'Delete a Message', 'Discord', 'action',
                'Delete a message from a Discord channel.',
                [p('channelId', 'text', true, 'Channel ID'), p('messageId', 'text', true, 'Message ID')]),
            m('discord:ActionCreateChannel', 'Create a Channel', 'Discord', 'action',
                'Create a new channel in a Discord server.',
                [p('guildId', 'text', true, 'Server/guild ID'), p('name', 'text', true, 'Channel name'), p('type', 'select', false, 'Channel type', { options: ['text', 'voice', 'category'] })]),
            m('discord:TriggerWatchMessages', 'Watch Messages', 'Discord', 'trigger',
                'Trigger when a new message is posted in a Discord channel.',
                [p('channelId', 'text', true, 'Channel ID')]),

            // ═══════════════════════════════════════
            // JIRA (6 modules)
            // ═══════════════════════════════════════
            m('jira:ActionCreateIssue', 'Create an Issue', 'Jira Software', 'action',
                'Creates a new issue (bug, task, story, epic) in a Jira project.',
                [p('projectKey', 'text', true, 'Project key (e.g., PROJ)'), p('issueType', 'select', true, 'Issue type', { options: ['Bug', 'Task', 'Story', 'Epic', 'Sub-task'] }), p('summary', 'text', true, 'Issue title'), p('description', 'text', false, 'Issue description'), p('priority', 'select', false, 'Priority', { options: ['Highest', 'High', 'Medium', 'Low', 'Lowest'] }), p('assignee', 'text', false, 'Assignee account ID'), p('labels', 'array', false, 'Labels')]),
            m('jira:ActionUpdateIssue', 'Update an Issue', 'Jira Software', 'action',
                'Updates fields of an existing Jira issue.',
                [p('issueKey', 'text', true, 'Issue key (e.g., PROJ-123)'), p('fields', 'object', true, 'Fields to update')]),
            m('jira:ActionTransitionIssue', 'Transition an Issue', 'Jira Software', 'action',
                'Move an issue to a different status (e.g., To Do → In Progress → Done).',
                [p('issueKey', 'text', true, 'Issue key'), p('transitionId', 'text', true, 'Transition ID or name')]),
            m('jira:ActionAddComment', 'Add a Comment', 'Jira Software', 'action',
                'Adds a comment to a Jira issue.',
                [p('issueKey', 'text', true, 'Issue key'), p('body', 'text', true, 'Comment body')]),
            m('jira:TriggerWatchIssues', 'Watch Issues', 'Jira Software', 'trigger',
                'Trigger when issues are created or updated in a Jira project.',
                [p('projectKey', 'text', true, 'Project key'), p('jql', 'text', false, 'JQL filter query')]),
            m('jira:SearchIssues', 'Search Issues', 'Jira Software', 'search',
                'Search for Jira issues using JQL (Jira Query Language).',
                [p('jql', 'text', true, 'JQL query (e.g., project=PROJ AND status="In Progress")'), p('maxResults', 'number', false, 'Max results')]),

            // ═══════════════════════════════════════
            // TRELLO (6 modules)
            // ═══════════════════════════════════════
            m('trello:ActionCreateCard', 'Create a Card', 'Trello', 'action',
                'Creates a new card in a Trello list.',
                [p('listId', 'text', true, 'List ID'), p('name', 'text', true, 'Card name'), p('description', 'text', false, 'Card description'), p('dueDate', 'date', false, 'Due date'), p('labels', 'array', false, 'Label IDs'), p('members', 'array', false, 'Member IDs')]),
            m('trello:ActionUpdateCard', 'Update a Card', 'Trello', 'action',
                'Updates an existing Trello card.',
                [p('cardId', 'text', true, 'Card ID'), p('name', 'text', false, 'New name'), p('description', 'text', false, 'New description'), p('listId', 'text', false, 'Move to list'), p('closed', 'boolean', false, 'Archive the card')]),
            m('trello:ActionAddComment', 'Add a Comment', 'Trello', 'action',
                'Adds a comment to a Trello card.',
                [p('cardId', 'text', true, 'Card ID'), p('text', 'text', true, 'Comment text')]),
            m('trello:ActionCreateList', 'Create a List', 'Trello', 'action',
                'Creates a new list on a Trello board.',
                [p('boardId', 'text', true, 'Board ID'), p('name', 'text', true, 'List name')]),
            m('trello:TriggerWatchCards', 'Watch Cards', 'Trello', 'trigger',
                'Trigger when a new card is created on a Trello board.',
                [p('boardId', 'text', true, 'Board ID')]),
            m('trello:SearchCards', 'Search Cards', 'Trello', 'search',
                'Search for cards on a Trello board.',
                [p('query', 'text', true, 'Search query'), p('boardId', 'text', false, 'Limit to board')]),

            // ═══════════════════════════════════════
            // ASANA (5 modules)
            // ═══════════════════════════════════════
            m('asana:ActionCreateTask', 'Create a Task', 'Asana', 'action',
                'Creates a new task in an Asana project.',
                [p('projectId', 'text', true, 'Project ID'), p('name', 'text', true, 'Task name'), p('notes', 'text', false, 'Task description'), p('assignee', 'text', false, 'Assignee email or ID'), p('dueOn', 'date', false, 'Due date'), p('tags', 'array', false, 'Tag IDs')]),
            m('asana:ActionUpdateTask', 'Update a Task', 'Asana', 'action',
                'Updates an existing Asana task.',
                [p('taskId', 'text', true, 'Task ID'), p('name', 'text', false, 'New name'), p('completed', 'boolean', false, 'Mark as complete')]),
            m('asana:ActionAddComment', 'Add a Comment', 'Asana', 'action',
                'Adds a comment/story to an Asana task.',
                [p('taskId', 'text', true, 'Task ID'), p('text', 'text', true, 'Comment text')]),
            m('asana:TriggerWatchTasks', 'Watch Tasks', 'Asana', 'trigger',
                'Trigger when new tasks are created in an Asana project.',
                [p('projectId', 'text', true, 'Project ID')]),
            m('asana:SearchTasks', 'Search Tasks', 'Asana', 'search',
                'Search for tasks in Asana.',
                [p('workspace', 'text', true, 'Workspace ID'), p('query', 'text', false, 'Search text')]),

            // ═══════════════════════════════════════
            // MONDAY.COM (5 modules)
            // ═══════════════════════════════════════
            m('monday:ActionCreateItem', 'Create an Item', 'monday.com', 'action',
                'Creates a new item in a monday.com board.',
                [p('boardId', 'text', true, 'Board ID'), p('itemName', 'text', true, 'Item name'), p('columnValues', 'object', false, 'Column values as JSON'), p('groupId', 'text', false, 'Group ID')]),
            m('monday:ActionUpdateItem', 'Update an Item', 'monday.com', 'action',
                'Updates column values of an item in monday.com.',
                [p('boardId', 'text', true, 'Board ID'), p('itemId', 'text', true, 'Item ID'), p('columnValues', 'object', true, 'Updated column values')]),
            m('monday:ActionCreateUpdate', 'Create an Update', 'monday.com', 'action',
                'Adds a text update/comment to a monday.com item.',
                [p('itemId', 'text', true, 'Item ID'), p('body', 'text', true, 'Update text')]),
            m('monday:TriggerWatchItems', 'Watch Items', 'monday.com', 'trigger',
                'Trigger when a new item is created on a monday.com board.',
                [p('boardId', 'text', true, 'Board ID')]),
            m('monday:TriggerWatchUpdates', 'Watch Column Values', 'monday.com', 'trigger',
                'Trigger when a column value changes on a monday.com board.',
                [p('boardId', 'text', true, 'Board ID'), p('columnId', 'text', false, 'Specific column to watch')]),

            // ═══════════════════════════════════════
            // SALESFORCE (5 modules)
            // ═══════════════════════════════════════
            m('salesforce:ActionCreateRecord', 'Create a Record', 'Salesforce', 'action',
                'Creates a new record (Lead, Contact, Account, Opportunity, etc.) in Salesforce.',
                [p('objectType', 'select', true, 'Object type', { options: ['Lead', 'Contact', 'Account', 'Opportunity', 'Case', 'Task', 'Custom'] }), p('fields', 'object', true, 'Field values')]),
            m('salesforce:ActionUpdateRecord', 'Update a Record', 'Salesforce', 'action',
                'Updates an existing Salesforce record.',
                [p('objectType', 'select', true, 'Object type', { options: ['Lead', 'Contact', 'Account', 'Opportunity', 'Case', 'Task', 'Custom'] }), p('recordId', 'text', true, 'Record ID'), p('fields', 'object', true, 'Updated fields')]),
            m('salesforce:TriggerWatchRecords', 'Watch Records', 'Salesforce', 'trigger',
                'Trigger when records are created or updated in Salesforce.',
                [p('objectType', 'text', true, 'Object type'), p('triggerType', 'select', false, 'Trigger on', { options: ['created', 'updated', 'both'] })]),
            m('salesforce:SearchRecords', 'Search Records (SOQL)', 'Salesforce', 'search',
                'Search Salesforce records using SOQL queries.',
                [p('query', 'text', true, 'SOQL query')]),
            m('salesforce:ActionMakeAPICall', 'Make an API Call', 'Salesforce', 'action',
                'Make a custom Salesforce REST API call.',
                [p('method', 'select', true, 'HTTP method', { options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }), p('url', 'text', true, 'API endpoint path'), p('body', 'text', false, 'Request body')]),

            // ═══════════════════════════════════════
            // STRIPE (5 modules)
            // ═══════════════════════════════════════
            m('stripe:TriggerWatchEvents', 'Watch Events', 'Stripe', 'trigger',
                'Trigger when new events occur in Stripe (payment_intent.succeeded, invoice.paid, customer.created, etc.).',
                [p('eventTypes', 'array', false, 'Filter by event types')]),
            m('stripe:ActionCreateCustomer', 'Create a Customer', 'Stripe', 'action',
                'Creates a new customer in Stripe.',
                [p('email', 'email', true, 'Customer email'), p('name', 'text', false, 'Customer name'), p('description', 'text', false, 'Description'), p('metadata', 'object', false, 'Custom metadata')]),
            m('stripe:ActionCreatePaymentIntent', 'Create a Payment Intent', 'Stripe', 'action',
                'Creates a payment intent for processing a payment.',
                [p('amount', 'number', true, 'Amount in cents'), p('currency', 'text', true, 'Currency code (usd, eur, etc.)'), p('customerId', 'text', false, 'Customer ID'), p('description', 'text', false, 'Payment description')]),
            m('stripe:ActionCreateInvoice', 'Create an Invoice', 'Stripe', 'action',
                'Creates a draft invoice for a Stripe customer.',
                [p('customerId', 'text', true, 'Customer ID'), p('description', 'text', false, 'Invoice description'), p('autoAdvance', 'boolean', false, 'Auto-finalize the invoice')]),
            m('stripe:SearchCharges', 'Search Charges', 'Stripe', 'search',
                'Search for charges/payments in Stripe.',
                [p('customerId', 'text', false, 'Filter by customer'), p('created', 'object', false, 'Date range filter'), p('limit', 'number', false, 'Max results')]),

            // ═══════════════════════════════════════
            // SHOPIFY (6 modules)
            // ═══════════════════════════════════════
            m('shopify:TriggerWatchOrders', 'Watch Orders', 'Shopify', 'trigger',
                'Trigger when a new order is placed in your Shopify store.',
                [p('status', 'select', false, 'Order status filter', { options: ['any', 'open', 'closed', 'cancelled'] })]),
            m('shopify:TriggerWatchProducts', 'Watch Products', 'Shopify', 'trigger',
                'Trigger when a new product is created in Shopify.',
                []),
            m('shopify:ActionCreateProduct', 'Create a Product', 'Shopify', 'action',
                'Creates a new product in your Shopify store.',
                [p('title', 'text', true, 'Product title'), p('description', 'text', false, 'Product description (HTML)'), p('vendor', 'text', false, 'Vendor name'), p('productType', 'text', false, 'Product type'), p('tags', 'text', false, 'Comma-separated tags'), p('variants', 'array', false, 'Product variants with price, SKU, etc.')]),
            m('shopify:ActionUpdateProduct', 'Update a Product', 'Shopify', 'action',
                'Updates an existing product in Shopify.',
                [p('productId', 'text', true, 'Product ID'), p('title', 'text', false, 'Updated title'), p('description', 'text', false, 'Updated description')]),
            m('shopify:ActionCreateOrder', 'Create an Order', 'Shopify', 'action',
                'Creates a new order in Shopify.',
                [p('lineItems', 'array', true, 'Order line items'), p('customer', 'object', false, 'Customer details'), p('shippingAddress', 'object', false, 'Shipping address')]),
            m('shopify:SearchProducts', 'Search Products', 'Shopify', 'search',
                'Search for products in your Shopify store.',
                [p('query', 'text', false, 'Search query'), p('productType', 'text', false, 'Filter by type'), p('vendor', 'text', false, 'Filter by vendor')]),

            // ═══════════════════════════════════════
            // MAILCHIMP (4 modules)
            // ═══════════════════════════════════════
            m('mailchimp:ActionAddMember', 'Add/Update a Subscriber', 'Mailchimp', 'action',
                'Add a subscriber to a Mailchimp audience or update an existing subscriber.',
                [p('listId', 'text', true, 'Audience/list ID'), p('email', 'email', true, 'Subscriber email'), p('status', 'select', true, 'Subscription status', { options: ['subscribed', 'unsubscribed', 'pending', 'cleaned'] }), p('mergeFields', 'object', false, 'Merge fields (FNAME, LNAME, etc.)'), p('tags', 'array', false, 'Tags to add')]),
            m('mailchimp:ActionSendCampaign', 'Send a Campaign', 'Mailchimp', 'action',
                'Send or schedule a Mailchimp email campaign.',
                [p('campaignId', 'text', true, 'Campaign ID')]),
            m('mailchimp:TriggerWatchSubscribers', 'Watch Subscribers', 'Mailchimp', 'trigger',
                'Trigger when a new subscriber is added to a Mailchimp audience.',
                [p('listId', 'text', true, 'Audience/list ID')]),
            m('mailchimp:SearchMembers', 'Search Members', 'Mailchimp', 'search',
                'Search for members in a Mailchimp audience.',
                [p('listId', 'text', true, 'Audience/list ID'), p('query', 'text', false, 'Search query')]),

            // ═══════════════════════════════════════
            // TWILIO (3 modules)
            // ═══════════════════════════════════════
            m('twilio:ActionSendSMS', 'Send an SMS', 'Twilio', 'action',
                'Send an SMS message via Twilio.',
                [p('to', 'text', true, 'Recipient phone number (E.164 format)'), p('from', 'text', true, 'Twilio phone number'), p('body', 'text', true, 'Message body (max 1600 chars)')]),
            m('twilio:ActionMakeCall', 'Make a Phone Call', 'Twilio', 'action',
                'Initiate a phone call via Twilio.',
                [p('to', 'text', true, 'Phone number to call'), p('from', 'text', true, 'Twilio phone number'), p('twiml', 'text', true, 'TwiML instructions or URL')]),
            m('twilio:TriggerWatchSMS', 'Watch SMS', 'Twilio', 'trigger',
                'Trigger when a new SMS message is received.',
                [p('phoneNumber', 'text', true, 'Twilio phone number to watch')]),

            // ═══════════════════════════════════════
            // GOOGLE GEMINI AI (3 modules)
            // ═══════════════════════════════════════
            m('gemini:ActionGenerateContent', 'Generate Content', 'Google Gemini AI', 'action',
                'Generate text content using Google Gemini AI models.',
                [p('model', 'select', true, 'Gemini model', { options: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'] }), p('prompt', 'text', true, 'Input prompt'), p('temperature', 'number', false, 'Temperature (0-2)'), p('maxOutputTokens', 'number', false, 'Max output tokens')]),
            m('gemini:ActionAnalyzeImage', 'Analyze an Image', 'Google Gemini AI', 'action',
                'Analyze images using Gemini multimodal capabilities.',
                [p('model', 'select', true, 'Model', { options: ['gemini-2.0-flash', 'gemini-1.5-pro'] }), p('image', 'buffer', true, 'Image file'), p('prompt', 'text', true, 'Analysis prompt')]),
            m('gemini:ActionGenerateEmbedding', 'Create an Embedding', 'Google Gemini AI', 'action',
                'Create text embeddings using Gemini embedding models.',
                [p('text', 'text', true, 'Text to embed'), p('model', 'select', true, 'Model', { options: ['text-embedding-004'] })]),

            // ═══════════════════════════════════════
            // ANTHROPIC CLAUDE (2 modules)
            // ═══════════════════════════════════════
            m('anthropic:ActionCreateMessage', 'Create a Message', 'Anthropic Claude', 'action',
                'Generate text using Anthropic Claude models. Send messages with system prompts and conversation history.',
                [p('model', 'select', true, 'Claude model', { options: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'] }), p('messages', 'array', true, 'Array of messages with role and content'), p('system', 'text', false, 'System prompt'), p('maxTokens', 'number', true, 'Max tokens in response'), p('temperature', 'number', false, 'Temperature (0-1)')]),
            m('anthropic:ActionAnalyzeImage', 'Analyze Images', 'Anthropic Claude', 'action',
                'Analyze images using Claude vision capabilities.',
                [p('model', 'select', true, 'Model', { options: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'] }), p('image', 'buffer', true, 'Image file or URL'), p('prompt', 'text', true, 'Analysis prompt'), p('maxTokens', 'number', true, 'Max tokens')]),

            // ═══════════════════════════════════════
            // WORDPRESS (4 modules)
            // ═══════════════════════════════════════
            m('wordpress:ActionCreatePost', 'Create a Post', 'WordPress', 'action',
                'Creates a new post or page in WordPress.',
                [p('title', 'text', true, 'Post title'), p('content', 'text', true, 'Post content (HTML)'), p('status', 'select', false, 'Post status', { options: ['draft', 'publish', 'pending', 'private'] }), p('categories', 'array', false, 'Category IDs'), p('tags', 'array', false, 'Tag IDs'), p('featuredImage', 'buffer', false, 'Featured image')]),
            m('wordpress:ActionUpdatePost', 'Update a Post', 'WordPress', 'action',
                'Updates an existing WordPress post.',
                [p('postId', 'number', true, 'Post ID'), p('title', 'text', false, 'Updated title'), p('content', 'text', false, 'Updated content'), p('status', 'select', false, 'Status')]),
            m('wordpress:ActionUploadMedia', 'Upload a Media File', 'WordPress', 'action',
                'Uploads a media file to the WordPress media library.',
                [p('file', 'buffer', true, 'File to upload'), p('filename', 'text', true, 'File name'), p('altText', 'text', false, 'Alt text')]),
            m('wordpress:TriggerWatchPosts', 'Watch Posts', 'WordPress', 'trigger',
                'Trigger when a new post is published in WordPress.',
                [p('status', 'select', false, 'Post status to watch', { options: ['publish', 'draft', 'any'] })]),

            // ═══════════════════════════════════════
            // DROPBOX (4 modules)
            // ═══════════════════════════════════════
            m('dropbox:ActionUploadFile', 'Upload a File', 'Dropbox', 'action',
                'Upload a file to Dropbox.',
                [p('path', 'text', true, 'Destination path (e.g., /folder/file.txt)'), p('data', 'buffer', true, 'File data'), p('mode', 'select', false, 'Write mode', { options: ['add', 'overwrite'] })]),
            m('dropbox:ActionCreateFolder', 'Create a Folder', 'Dropbox', 'action',
                'Creates a new folder in Dropbox.',
                [p('path', 'text', true, 'Folder path')]),
            m('dropbox:ActionDownloadFile', 'Download a File', 'Dropbox', 'action',
                'Downloads a file from Dropbox.',
                [p('path', 'text', true, 'File path in Dropbox')]),
            m('dropbox:TriggerWatchFiles', 'Watch Files', 'Dropbox', 'trigger',
                'Trigger when files are created or modified in a Dropbox folder.',
                [p('path', 'text', true, 'Folder path to watch')]),

            // ═══════════════════════════════════════
            // GITHUB (5 modules)
            // ═══════════════════════════════════════
            m('github:ActionCreateIssue', 'Create an Issue', 'GitHub', 'action',
                'Creates a new issue in a GitHub repository.',
                [p('owner', 'text', true, 'Repository owner'), p('repo', 'text', true, 'Repository name'), p('title', 'text', true, 'Issue title'), p('body', 'text', false, 'Issue description (Markdown)'), p('labels', 'array', false, 'Label names'), p('assignees', 'array', false, 'Assignee usernames')]),
            m('github:ActionCreatePullRequest', 'Create a Pull Request', 'GitHub', 'action',
                'Creates a new pull request in a GitHub repository.',
                [p('owner', 'text', true, 'Repository owner'), p('repo', 'text', true, 'Repository name'), p('title', 'text', true, 'PR title'), p('head', 'text', true, 'Head branch'), p('base', 'text', true, 'Base branch'), p('body', 'text', false, 'PR description')]),
            m('github:ActionAddComment', 'Add a Comment', 'GitHub', 'action',
                'Adds a comment to a GitHub issue or pull request.',
                [p('owner', 'text', true, 'Repository owner'), p('repo', 'text', true, 'Repository name'), p('issueNumber', 'number', true, 'Issue or PR number'), p('body', 'text', true, 'Comment body')]),
            m('github:TriggerWatchEvents', 'Watch Events', 'GitHub', 'trigger',
                'Trigger on GitHub repository events (push, pull_request, issues, etc.).',
                [p('owner', 'text', true, 'Repository owner'), p('repo', 'text', true, 'Repository name'), p('events', 'array', false, 'Event types to watch')]),
            m('github:SearchIssues', 'Search Issues/PRs', 'GitHub', 'search',
                'Search GitHub issues and pull requests.',
                [p('query', 'text', true, 'GitHub search query'), p('sort', 'select', false, 'Sort by', { options: ['created', 'updated', 'comments'] })]),

            // ═══════════════════════════════════════
            // RSS (1 module)
            // ═══════════════════════════════════════
            m('rss:TriggerWatchFeed', 'Watch RSS Feed Items', 'RSS', 'trigger',
                'Trigger when a new item appears in an RSS feed. Great for monitoring blogs, news sites, and content updates.',
                [p('url', 'url', true, 'RSS feed URL'), p('limit', 'number', false, 'Max items per run')]),

            // ═══════════════════════════════════════
            // WHATSAPP BUSINESS (3 modules)
            // ═══════════════════════════════════════
            m('whatsapp:ActionSendMessage', 'Send a Message', 'WhatsApp Business', 'action',
                'Send a WhatsApp message via the WhatsApp Business API.',
                [p('to', 'text', true, 'Recipient phone number'), p('type', 'select', true, 'Message type', { options: ['text', 'template', 'image', 'document'] }), p('text', 'text', false, 'Message text (for text type)'), p('templateName', 'text', false, 'Template name (for template type)')]),
            m('whatsapp:ActionSendTemplate', 'Send a Template Message', 'WhatsApp Business', 'action',
                'Send a pre-approved WhatsApp template message.',
                [p('to', 'text', true, 'Recipient phone number'), p('templateName', 'text', true, 'Template name'), p('languageCode', 'text', true, 'Language code'), p('components', 'array', false, 'Template components/variables')]),
            m('whatsapp:TriggerWatchMessages', 'Watch Messages', 'WhatsApp Business', 'trigger',
                'Trigger when a new WhatsApp message is received.',
                []),

            // ═══════════════════════════════════════
            // FLOW CONTROL & TOOLS (7 modules)
            // ═══════════════════════════════════════
            m('builtin:BasicRouter', 'Router', 'Flow Control', 'action',
                'Split the scenario flow into multiple routes based on conditions (filters). Each route can have its own filter and processes independently.',
                [p('routes', 'array', true, 'Route configurations with filter conditions')],
                '## Router\nSplit your scenario into multiple branches.\n\n### Usage\n- Add filters to each route to control data flow\n- Use for conditional logic (if/else)\n- Unfiltered routes act as "else" (default)'),
            m('builtin:BasicAggregator', 'Array Aggregator', 'Flow Control', 'action',
                'Aggregate multiple bundles into a single array. Collects output from iterators or repeated modules into one bundle.',
                [p('sourceModule', 'select', true, 'Module whose output to aggregate'), p('groupBy', 'text', false, 'Group aggregation by field value')]),
            m('builtin:TextAggregator', 'Text Aggregator', 'Flow Control', 'action',
                'Aggregate multiple bundles into a single text string with a separator.',
                [p('sourceModule', 'select', true, 'Module whose output to aggregate'), p('separator', 'text', false, 'Text separator between items'), p('rowSeparator', 'text', false, 'Row separator')]),
            m('builtin:NumericAggregator', 'Numeric Aggregator', 'Flow Control', 'action',
                'Compute sum, average, count, min, or max across multiple bundles.',
                [p('sourceModule', 'select', true, 'Module to aggregate'), p('function', 'select', true, 'Aggregation function', { options: ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'] }), p('value', 'text', true, 'Value field to aggregate')]),
            m('builtin:BasicIterator', 'Iterator', 'Flow Control', 'action',
                'Split an array into separate bundles, processing each item individually in subsequent modules.',
                [p('array', 'array', true, 'Array to iterate over')]),
            m('builtin:Repeater', 'Repeater', 'Flow Control', 'action',
                'Repeat subsequent modules a specified number of times. Useful for retry logic or generating sequences.',
                [p('repeats', 'number', true, 'Number of times to repeat'), p('initialValue', 'number', false, 'Starting counter value'), p('step', 'number', false, 'Counter increment')]),
            m('builtin:SetVariable', 'Set Variable', 'Tools', 'action',
                'Set one or more variables that can be referenced in subsequent modules. Variables persist within a single scenario run.',
                [p('variables', 'array', true, 'Variable name-value pairs to set')]),
            m('builtin:SetMultipleVariables', 'Set Multiple Variables', 'Tools', 'action',
                'Set multiple variables at once.',
                [p('variables', 'array', true, 'Array of {name, value} pairs')]),
            m('builtin:GetVariable', 'Get Variable', 'Tools', 'action',
                'Retrieve a variable value that was previously set.',
                [p('name', 'text', true, 'Variable name')]),
            m('builtin:IncrementVariable', 'Increment Value', 'Tools', 'action',
                'Increment a numeric variable by a specified amount.',
                [p('name', 'text', true, 'Variable name'), p('value', 'number', true, 'Amount to increment by')]),
            m('builtin:Sleep', 'Sleep', 'Tools', 'action',
                'Pause scenario execution for a specified duration. Useful for rate limiting or waiting for external processes.',
                [p('delay', 'number', true, 'Delay in seconds (max 300)')]),
            m('builtin:Compose', 'Compose a String', 'Tools', 'action',
                'Create a text string by combining static text with mapped values from previous modules.',
                [p('text', 'text', true, 'Text template with mapped values')]),
            m('builtin:SetError', 'Throw Error', 'Tools', 'action',
                'Deliberately throw an error to stop scenario execution or trigger error handling.',
                [p('message', 'text', true, 'Error message'), p('status', 'number', false, 'Error status code')]),

            // ═══════════════════════════════════════
            // TEXT PARSER (3 modules)
            // ═══════════════════════════════════════
            m('regexp:ActionMatch', 'Match Pattern', 'Text Parser', 'action',
                'Extract data from text using regular expressions. Returns matched groups for data extraction.',
                [p('pattern', 'text', true, 'Regular expression pattern'), p('text', 'text', true, 'Text to search in'), p('globalMatch', 'boolean', false, 'Find all matches (not just first)'), p('caseSensitive', 'boolean', false, 'Case-sensitive matching', { default: true })]),
            m('regexp:ActionReplace', 'Replace', 'Text Parser', 'action',
                'Replace text matching a pattern with new text. Supports regex patterns and capture groups.',
                [p('pattern', 'text', true, 'Search pattern (text or regex)'), p('text', 'text', true, 'Source text'), p('replacement', 'text', true, 'Replacement text'), p('globalReplace', 'boolean', false, 'Replace all occurrences')]),
            m('regexp:ActionHTMLToText', 'HTML to Text', 'Text Parser', 'action',
                'Convert HTML to plain text, stripping all HTML tags.',
                [p('html', 'text', true, 'HTML content to convert')]),

            // ═══════════════════════════════════════
            // DATA STORE (3 modules)
            // ═══════════════════════════════════════
            m('datastore:ActionAddRecord', 'Add/Replace a Record', 'Data Store', 'action',
                'Add a new record to a Make Data Store, or replace an existing one by key.',
                [p('dataStore', 'text', true, 'Data store name/ID'), p('key', 'text', true, 'Record key'), p('data', 'object', true, 'Record data fields')]),
            m('datastore:ActionGetRecord', 'Get a Record', 'Data Store', 'search',
                'Retrieve a record from a Data Store by its key.',
                [p('dataStore', 'text', true, 'Data store name/ID'), p('key', 'text', true, 'Record key')]),
            m('datastore:ActionDeleteRecord', 'Delete a Record', 'Data Store', 'action',
                'Delete a record from a Data Store.',
                [p('dataStore', 'text', true, 'Data store name/ID'), p('key', 'text', true, 'Record key to delete')]),
            m('datastore:SearchRecords', 'Search Records', 'Data Store', 'search',
                'Search for records in a Data Store using filters.',
                [p('dataStore', 'text', true, 'Data store name/ID'), p('filter', 'object', false, 'Filter conditions'), p('limit', 'number', false, 'Max records to return')]),

            // ═══════════════════════════════════════
            // MAKE UTILITIES (3 modules)
            // ═══════════════════════════════════════
            m('email:ActionSendEmail', 'Send an Email', 'Email', 'action',
                'Send an email using Make built-in SMTP (no external service needed). Limited to basic emails.',
                [p('to', 'email', true, 'Recipient email'), p('subject', 'text', true, 'Subject'), p('body', 'text', true, 'Body')]),
            m('csv:ActionParseCSV', 'Parse CSV', 'CSV', 'action',
                'Parse a CSV string or file into structured data bundles.',
                [p('csv', 'text', true, 'CSV content'), p('delimiter', 'text', false, 'Field delimiter', { default: ',' }), p('containsHeaders', 'boolean', false, 'First row is headers', { default: true })]),
            m('csv:ActionCreateCSV', 'Create CSV', 'CSV', 'action',
                'Create a CSV file from structured data.',
                [p('dataStructure', 'select', true, 'Data structure'), p('includeHeaders', 'boolean', false, 'Include header row', { default: true })]),

            // ═══════════════════════════════════════
            // SCHEDULE (1 module)
            // ═══════════════════════════════════════
            m('builtin:Schedule', 'Schedule', 'Schedule', 'trigger',
                'Trigger a scenario on a recurring schedule (every X minutes, hourly, daily, weekly, monthly, or custom cron).',
                [p('interval', 'select', true, 'Run interval', { options: ['every 15 minutes', 'every hour', 'every day', 'every week', 'every month', 'custom'] }), p('cron', 'text', false, 'Custom cron expression (for custom interval)')],
                '## Schedule Trigger\nRun scenarios on a timer.\n\n### Common Intervals\n- Every 15 minutes: Check for new data periodically\n- Daily: Morning reports, daily syncs\n- Weekly: Weekly digests, cleanup tasks'),
        ];
    }

    async populateDatabase() {
        console.log('Populating database with Make.com modules...');

        const modules = await this.scrapeFromMakeAPI();

        let success = 0;
        let failed = 0;

        for (const mod of modules) {
            try {
                this.db.insertModule(mod);
                console.log(`  ✅ ${mod.app} → ${mod.name}`);
                success++;
            } catch (error: any) {
                console.error(`  ❌ ${mod.name}: ${error.message}`);
                failed++;
            }
        }

        console.log(`\nDone! ${success} modules inserted, ${failed} failed.`);
        console.log(`Total modules in database: ${modules.length}`);
        this.db.close();
    }
}

const isMain = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '');
if (isMain) {
    const scraper = new ModuleScraper();
    scraper.populateDatabase().catch(console.error);
}
